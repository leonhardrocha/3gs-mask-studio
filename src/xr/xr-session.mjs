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
 * Optional surface snap (`data.xrSnapToSurface`, default off): a `pc.Picker`
 * depth probe along the ray; experimental in XR, so it's opt-in.
 *
 * Controls (grip reserved for phase-4 navigation):
 *   - trigger: select at the brush sphere (held = brush).
 *   - right thumbstick Y: push the brush nearer/farther along the ray.
 *   - right thumbstick X: brush size.
 *   - A: toggle additive/subtractive (sphere color flips).
 *   - B: clear selection.
 */
export function createXrSession({ app, camera, cameraParent, system, data, onSessionChange }) {
    const controllers = [];
    const locomotion = createLocomotion({ camera, cameraParent });

    // Auxiliary camera + picker for OPTIONAL surface snap.
    const pickCam = new pc.Entity('xr-pick-cam');
    pickCam.addComponent('camera', { nearClip: 0.01, farClip: 200, fov: 30 });
    pickCam.enabled = false;
    app.root.addChild(pickCam);
    const picker = new pc.Picker(app, 48, 48, true);
    const worldLayer = app.scene.layers.getLayerByName('World');

    const tmpTarget = new pc.Vec3();
    const brushCenter = new pc.Vec3();
    const snappedCenter = new pc.Vec3();
    let snapValid = false;
    let lastSnap = 0;
    let prevA = false;
    let prevB = false;

    const snap = (origin, dir) => {
        pickCam.setPosition(origin);
        tmpTarget.copy(dir).add(origin);
        pickCam.lookAt(tmpTarget);
        picker.prepare(pickCam.camera, app.scene, [worldLayer]);
        return picker.getWorldPointAsync(picker.width >> 1, picker.height >> 1);
    };

    if (app.xr?.supported) {
        app.xr.input.on('add', (inputSource) => {
            const entity = createControllerEntity({ cameraParent, inputSource });
            controllers.push(entity);
            inputSource.on('remove', () => {
                const idx = controllers.indexOf(entity);
                if (idx >= 0) controllers.splice(idx, 1);
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

        const right = getPreferredInputSource(controllers, pc.XRHAND_RIGHT);
        const left = getPreferredInputSource(controllers, pc.XRHAND_LEFT);

        // Locomotion: left stick = move, right stick X = snap turn.
        locomotion.update({ leftSource: left, rightSource: right, dt, data });

        if (!right) return; // selection needs the right controller
        const pad = right.gamepad;

        // (Right stick is movement-only now — brush distance is set via the panel
        //  slider / desktop; locomotion owns both right-stick axes.)
        // Right A/B: toggle mode / clear.
        if (pad && pad.buttons.length > 5) {
            const a = pad.buttons[4].pressed, b = pad.buttons[5].pressed;
            if (a && !prevA) data.set('selectionMode', data.get('selectionMode') === 'additive' ? 'subtractive' : 'additive');
            if (b && !prevB) data.emit('clearSelection');
            prevA = a; prevB = b;
        }
        // Brush size via LEFT buttons (X = shrink, Y = grow), freeing the right stick for turning.
        const lpad = left?.gamepad;
        if (lpad && lpad.buttons.length > 5) {
            const cur = data.get('brushSize') ?? 0.15;
            if (lpad.buttons[5].pressed) data.set('brushSize', pc.math.clamp(cur + dt * 0.5, 0.02, 1.0));
            else if (lpad.buttons[4].pressed) data.set('brushSize', pc.math.clamp(cur - dt * 0.5, 0.02, 1.0));
        }

        const mode = data.get('selectionMode') === 'subtractive' ? SELECT_SUBTRACTIVE : SELECT_ADDITIVE;
        const brush = data.get('brushSize') ?? 0.15;
        const dist = data.get('xrRayDistance') ?? 1.5;

        // Brush center: fixed distance along the ray (default), or surface snap if enabled.
        brushCenter.copy(right.getDirection()).mulScalar(dist).add(right.getOrigin());
        if (data.get('xrSnapToSurface')) {
            const now = performance.now();
            if (now - lastSnap > 70) {
                lastSnap = now;
                snap(right.getOrigin(), right.getDirection()).then((wp) => {
                    snapValid = !!wp;
                    if (wp) snappedCenter.copy(wp);
                });
            }
            if (snapValid) brushCenter.copy(snappedCenter);
        }

        // Visible brush sphere: position + size + mode color (feedback).
        const col = mode === SELECT_ADDITIVE ? pc.Color.GREEN : pc.Color.RED;
        app.drawWireSphere(brushCenter, brush, col, 16);

        if (right.selecting) {
            system.queueSelect(brushCenter, brush, mode);
        }
    };

    const destroy = () => {
        picker.destroy();
        pickCam.destroy();
    };

    return {
        enter,
        update,
        destroy,
        controllers,
        get active() { return !!app.xr?.active; },
        get supported() { return !!app.xr?.supported; }
    };
}
