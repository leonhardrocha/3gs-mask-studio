import * as pc from 'playcanvas';

import { createControllerEntity, updateControllers, getPreferredInputSource } from './controllers.mjs';
import { createLocomotion } from './locomotion.mjs';
import { SELECT_ADDITIVE, SELECT_SUBTRACTIVE } from '../selection/selection-system.mjs';

/**
 * XR session: enter/exit VR, controller management, and selection by controller ray.
 *
 * Brush placement (robust default): the brush sits at an adjustable DISTANCE along
 * the controller ray. A visible wireframe sphere is drawn at the brush position
 * every frame — its radius is the brush size and its color encodes the mode
 * (green = additive, red = subtractive). This gives immediate feedback for where
 * you're selecting, the brush size, and the active mode.
 *
 * Optional surface snap (`data.xrSnapToSurface`, default off): a CPU spatial
 * index (`splat-index.mjs`) ray-marches the splat centers — no GPU readback, so
 * no per-frame hitch. The lateral position stays 1:1 on the ray; only the depth
 * is snapped and then smoothed (with jump gating) for a stable feel.
 *
 * Controls (grip reserved for phase-4 navigation):
 *   - trigger: select at the brush sphere (held = brush).
 *   - right thumbstick Y: push the brush nearer/farther along the ray.
 *   - right thumbstick X: brush size.
 *   - A: toggle additive/subtractive (sphere color flips).
 *   - B: clear selection.
 */
export function createXrSession({ app, camera, cameraParent, system, data, splatIndex, controllerModels, panel, onSessionChange }) {
    const controllers = [];
    const locomotion = createLocomotion({ camera, cameraParent });

    const brushCenter = new pc.Vec3();
    let prevA = false;
    let prevB = false;
    let prevSelecting = false;
    let navCooldownV = 0, navCooldownH = 0; // discrete-step gating for panel nav

    // Surface-snap depth smoothing (Fase 1.5): lateral stays 1:1 on the ray; only
    // the DEPTH glides toward the snapped surface, and a large jump must persist a
    // few frames before being accepted (avoids foreground/background flicker).
    const SNAP_TAU = 0.05;       // s — depth smoothing time constant
    const SNAP_MAX_JUMP = 0.4;   // m — depth jumps beyond this are gated
    const SNAP_GATE_FRAMES = 3;
    const SNAP_MAX_DIST = 30;    // m — ray-march cap
    let smoothDepth = null;
    let gateTarget = null, gateCount = 0;
    let prevRaw = -1;
    const snapStats = { hits: 0, total: 0, jitter: 0 };

    const updateSmoothedDepth = (rawT, fallback, dt) => {
        snapStats.total++;
        if (rawT > 0) {
            snapStats.hits++;
            if (prevRaw > 0) snapStats.jitter = Math.abs(rawT - prevRaw);
            prevRaw = rawT;
        }
        let target = rawT > 0 ? rawT : (smoothDepth ?? fallback); // dropout: hold last depth
        if (smoothDepth == null) { smoothDepth = target; return smoothDepth; }
        if (Math.abs(target - smoothDepth) > SNAP_MAX_JUMP) {
            if (gateTarget != null && Math.abs(target - gateTarget) < SNAP_MAX_JUMP) gateCount++;
            else { gateTarget = target; gateCount = 1; }
            if (gateCount < SNAP_GATE_FRAMES) target = smoothDepth; // ignore until sustained
            else { gateTarget = null; gateCount = 0; }
        } else { gateTarget = null; gateCount = 0; }
        const alpha = 1 - Math.exp(-dt / Math.max(1e-4, SNAP_TAU));
        smoothDepth += (target - smoothDepth) * alpha;
        return smoothDepth;
    };
    const resetSnap = () => { smoothDepth = null; prevRaw = -1; gateTarget = null; gateCount = 0; };

    if (app.xr?.supported) {
        app.xr.input.on('add', (inputSource) => {
            const entity = createControllerEntity({ cameraParent, inputSource });
            controllers.push(entity);
            controllerModels?.attach(inputSource, entity);
            inputSource.on('remove', () => {
                const idx = controllers.indexOf(entity);
                if (idx >= 0) controllers.splice(idx, 1);
                controllerModels?.remove(inputSource);
                entity.destroy();
            });
        });

        app.xr.on('start', () => {
            if (camera.script) camera.script.enabled = false; // don't fight the HMD pose
            onSessionChange?.(true);
        });
        app.xr.on('end', () => {
            if (camera.script) camera.script.enabled = true;
            onSessionChange?.(false);
        });
    }

    const enter = () => {
        const xr = app.xr;
        if (!xr || !xr.supported) { console.warn('[xr] WebXR não suportado neste navegador'); return; }
        if (xr.active) return;
        if (!xr.isAvailable(pc.XRTYPE_VR)) { console.warn('[xr] sessão VR indisponível'); return; }
        xr.start(camera.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCALFLOOR, {
            callback: err => { if (err) console.error('[xr] falha ao iniciar VR:', err); }
        });
    };

    const update = (dt) => {
        const rayDist = data.get('xrRayDistance') ?? 1.5;
        updateControllers({ app, controllers, rayVisible: data.get('xrRayVisible') !== false, rayLength: rayDist });
        if (!app.xr?.active) return;

        // Animate the Input-Profiles models (button/trigger/grip/thumbstick feedback).
        controllerModels?.update();

        const right = getPreferredInputSource(controllers, pc.XRHAND_RIGHT);
        const left = getPreferredInputSource(controllers, pc.XRHAND_LEFT);
        const rpad = right?.gamepad;
        const lpad = left?.gamepad;

        // A (right button 4): open/close the mode panel (rising edge).
        const aPressed = !!(rpad && rpad.buttons.length > 4 && rpad.buttons[4].pressed);
        if (aPressed && !prevA) panel?.toggle();
        prevA = aPressed;

        // --- Panel OPEN: joystick navigation, locomotion + brush suspended ----
        if (panel?.isOpen) {
            navCooldownV -= dt; navCooldownH -= dt;
            if (lpad && lpad.axes.length > 3) {
                const lx = lpad.axes[2] ?? 0, ly = lpad.axes[3] ?? 0;
                // Vertical: discrete focus steps.
                if (Math.abs(ly) > 0.6) { if (navCooldownV <= 0) { panel.navVertical(ly > 0 ? 1 : -1); navCooldownV = 0.22; } } else navCooldownV = 0;
                // Horizontal: continuous (proportional) adjust on numeric rows, else discrete step.
                if (panel.focusedIsContinuous()) {
                    if (Math.abs(lx) > 0.15) panel.adjustContinuous(lx * dt);
                    navCooldownH = 0;
                } else if (Math.abs(lx) > 0.6) {
                    if (navCooldownH <= 0) { panel.navHorizontal(lx > 0 ? 1 : -1); navCooldownH = 0.22; }
                } else navCooldownH = 0;
            }
            if (right?.selecting && !prevSelecting) panel.activate(); // trigger = confirm
            prevSelecting = !!right?.selecting;
            const bPressed = !!(rpad && rpad.buttons.length > 5 && rpad.buttons[5].pressed);
            if (bPressed && !prevB) panel.close();
            prevB = bPressed;
            return;
        }

        // --- Panel CLOSED: locomotion always; brush only in Seleção mode ------
        locomotion.update({ leftSource: left, rightSource: right, dt, data });

        // Brush size on left X/− and Y/+ (hold to repeat). Icons hint this on the model.
        if (lpad && lpad.buttons.length > 5) {
            const bs = data.get('brushSize') ?? 0.15;
            if (lpad.buttons[5].pressed) data.set('brushSize', +pc.math.clamp(bs + dt * 0.4, 0.02, 1).toFixed(3));
            else if (lpad.buttons[4].pressed) data.set('brushSize', +pc.math.clamp(bs - dt * 0.4, 0.02, 1).toFixed(3));
        }

        if (!right || (panel && panel.currentModeId !== 'select')) {
            prevSelecting = !!right?.selecting; // keep stroke-edge state coherent
            return;
        }

        const mode = data.get('selectionMode') === 'subtractive' ? SELECT_SUBTRACTIVE : SELECT_ADDITIVE;
        const brush = data.get('brushSize') ?? 0.15;
        const dist = data.get('xrRayDistance') ?? 1.5;

        // Brush center: fixed distance along the ray (default), or CPU-index
        // surface snap (lateral stays on the ray; only the depth is snapped).
        brushCenter.copy(right.getDirection()).mulScalar(dist).add(right.getOrigin());
        if (data.get('xrSnapToSurface') && splatIndex) {
            const rawT = splatIndex.raycast(right.getOrigin(), right.getDirection(), SNAP_MAX_DIST);
            const depth = updateSmoothedDepth(rawT, dist, dt);
            brushCenter.copy(right.getDirection()).mulScalar(depth).add(right.getOrigin());
            if ((snapStats.total & 7) === 0) {
                data.set('snapStats', {
                    depth: +depth.toFixed(3),
                    jitter: +snapStats.jitter.toFixed(4),
                    dropout: +(1 - snapStats.hits / Math.max(1, snapStats.total)).toFixed(3)
                });
            }
        } else if (smoothDepth != null) {
            resetSnap();
        }

        // Visible brush sphere: position + size + mode color (feedback).
        const col = mode === SELECT_ADDITIVE ? pc.Color.GREEN : pc.Color.RED;
        app.drawWireSphere(brushCenter, brush, col, 16);

        // Stroke boundaries for undo (rising/falling edge of the trigger).
        if (right.selecting && !prevSelecting) system.beginStroke();
        else if (!right.selecting && prevSelecting) system.endStroke();
        prevSelecting = right.selecting;

        if (right.selecting) {
            system.queueSelect(brushCenter, brush, mode);
        }
    };

    const destroy = () => {};

    return {
        enter,
        update,
        destroy,
        controllers,
        get active() { return !!app.xr?.active; },
        get supported() { return !!app.xr?.supported; }
    };
}
