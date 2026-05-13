/**
 * vr-studio-plugin.mjs — PlayCanvas Script plugin para VR/XR
 *
 * Responsabilidades:
 *   - Camera rig (XRRig entity como pai da câmera para locomotion)
 *   - Sessão XR: start / end / toggle com API pública
 *   - Leitura de controladores XR → dispara eventos PlayCanvas:
 *       app.fire('xr:pose',    { source, origin, direction })
 *       app.fire('xr:trigger', { source, pressed })
 *       app.fire('xr:navigate',{ dx, dz })
 *       app.fire('xr:clear')
 *       app.fire('xr:cycle-op')
 *   - UI: injeta botão 🕶️ no #bottom-toolbar (SuperSplat) se disponível
 *   - Hotkey: Alt+V → toggleVR(); Alt+C → app.fire('selection:clear')
 *
 * Uso (standalone app):
 *   import { initVRPlugin } from './scripts/vr-studio-plugin.mjs';
 *   initVRPlugin(app);  // registra a classe no Script Registry
 *
 *   const mgr = new pc.Entity('VRPluginManager');
 *   mgr.addComponent('script');
 *   mgr.script.create('vrStudio', { properties: { speed: 3.5, coneAngle: 45 } });
 *   app.root.addChild(mgr);
 */

import * as pc from '../../engine/build/playcanvas.mjs';

// ---------------------------------------------------------------------------
// Classe do script
// ---------------------------------------------------------------------------
export class VrStudioPlugin extends pc.Script {
    static scriptName = 'vrStudio';
}

VrStudioPlugin.attributes.add('speed',     { type: 'number', default: 2.0 });
VrStudioPlugin.attributes.add('coneAngle', { type: 'number', default: 30  });
VrStudioPlugin.attributes.add('coneRange', { type: 'number', default: 5   });

VrStudioPlugin.prototype.initialize = function () {
    /** @type {pc.Entity|null} */
    this._rig = null;

    // Button-state guards (rising-edge detection)
    this._xrTriggerWasPressed = false;
    this._xrClearWasPressed   = false;
    this._xrCycleWasPressed   = false;

    this._setupCameraRig();
    this._setupXrEvents();
    this._setupHotkeys();
    this._injectToolbarButton();

    console.log('[VrStudioPlugin] Plug-in VR Studio carregado e pronto.');
};

// ---------------------------------------------------------------------------
// Camera rig
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype._setupCameraRig = function () {
    const cameras = this.app.root.findComponents('camera');
    if (!cameras?.length) return;
    const cameraEntity = cameras[0].entity;

    if (cameraEntity.parent === this.app.root) {
        this._rig = new pc.Entity('XRRig');
        this.app.root.addChild(this._rig);
        // Posiciona o rig na posição atual da câmera antes de reparentar.
        this._rig.setPosition(cameraEntity.getPosition());
        cameraEntity.reparent(this._rig);
    } else {
        // Usa o pai existente como rig (já foi configurado antes).
        this._rig = cameraEntity.parent;
    }
};

VrStudioPlugin.prototype._getCameraEntity = function () {
    const cameras = this.app.root.findComponents('camera');
    return cameras?.length ? cameras[0].entity : null;
};

// ---------------------------------------------------------------------------
// Eventos XR (lifecycle)
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype._setupXrEvents = function () {
    if (!this.app.xr) return;

    this.app.xr.on('start', () => {
        this._updateToolbarButton(true);

        // Desativa orbit/fly camera durante a sessão XR para evitar conflitos.
        const cam = this._getCameraEntity();
        if (cam?.script?.cameraControls) {
            cam.script.cameraControls.enabled = false;
        }
    });

    this.app.xr.on('end', () => {
        this._updateToolbarButton(false);

        // Reativa orbit camera ao sair do XR.
        const cam = this._getCameraEntity();
        if (cam?.script?.cameraControls) {
            cam.script.cameraControls.enabled = true;
        }
    });
};

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype._setupHotkeys = function () {
    const onKey = (e) => {
        if (!e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'v') {
            e.preventDefault();
            this.toggleVR();
        } else if (k === 'c') {
            e.preventDefault();
            this.app.fire('selection:clear');
        }
    };
    window.addEventListener('keydown', onKey);
    this._keydownHandler = onKey;
};

// ---------------------------------------------------------------------------
// Toolbar button (#bottom-toolbar do SuperSplat)
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype._injectToolbarButton = function () {
    if (document.getElementById('btn-vr-studio')) return;

    const toolbar = document.getElementById('bottom-toolbar');
    if (!toolbar) return;

    const btn = document.createElement('button');
    btn.id        = 'btn-vr-studio';
    btn.className = 'bottom-toolbar-button';
    btn.title     = 'Entrar em VR (Alt+V)';
    btn.textContent = '🕶️';
    btn.addEventListener('click', () => this.toggleVR());
    toolbar.appendChild(btn);
};

VrStudioPlugin.prototype._updateToolbarButton = function (active) {
    const btn = document.getElementById('btn-vr-studio');
    if (!btn) return;
    btn.classList.toggle('bottom-toolbar-toggle', active);
};

// ---------------------------------------------------------------------------
// Helpers de leitura de input XR
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype._readXrButton = function (source, index) {
    if (typeof source.getButton === 'function') {
        const v = source.getButton(index);
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number')  return v > 0.5;
    }
    const gp  = source.inputSource?.gamepad ?? source.gamepad;
    const btn = gp?.buttons?.[index];
    if (!btn) return false;
    if (typeof btn === 'object') return btn.pressed ?? (Number(btn.value ?? 0) > 0.5);
    return Number(btn) > 0.5;
};

VrStudioPlugin.prototype._readNavAxes = function (source) {
    const gp   = source.inputSource?.gamepad ?? source.gamepad;
    const axes = gp?.axes || [];
    const DZ   = 0.12;
    const applyDz = (v) => Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ);

    // Maioria dos runtimes XR usa eixos 2/3 para o thumbstick; fallback 0/1.
    const x23 = applyDz(axes[2] ?? 0), y23 = applyDz(axes[3] ?? 0);
    const x01 = applyDz(axes[0] ?? 0), y01 = applyDz(axes[1] ?? 0);
    return Math.hypot(x23, y23) >= Math.hypot(x01, y01) ? [x23, y23] : [x01, y01];
};

VrStudioPlugin.prototype._getXrPose = function (source) {
    // API nova: getOrigin / getDirection (PlayCanvas >= 1.60)
    if (typeof source.getOrigin === 'function' && typeof source.getDirection === 'function') {
        const o = source.getOrigin();
        const d = source.getDirection();
        if (o && d) {
            return { origin: o.clone(), direction: d.clone().normalize() };
        }
    }
    // API legada: getPosition / getRotation
    if (typeof source.getPosition === 'function' && typeof source.getRotation === 'function') {
        const p = source.getPosition();
        const r = source.getRotation();
        if (p && r) {
            const q   = new pc.Quat(r.x, r.y, r.z, r.w);
            const dir = q.transformVector(new pc.Vec3(0, 0, -1));
            return { origin: p.clone(), direction: dir.normalize() };
        }
    }
    return null;
};

// ---------------------------------------------------------------------------
// update(dt) — loop nativo do PlayCanvas (substitui requestAnimationFrame XR)
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype.update = function (dt) {
    if (!this.app.xr?.active) return;

    const sources = this.app.xr.input?.sources || [];

    // Classifica fontes por lateralidade.
    let aimSource = null, navSource = null;
    for (const src of sources) {
        const hand = String(src?.handedness || '').toLowerCase();
        if (hand === 'right' && !aimSource) { aimSource = src; }
        else if (hand === 'left'  && !navSource) { navSource = src; }
        else if (!aimSource) { aimSource = src; }
    }
    // Com dois controllers sem lateralidade definida: segundo vira navSource.
    if (!navSource && sources.length >= 2) {
        navSource = sources.find(s => s !== aimSource) ?? null;
    }

    // --- Controlador direito: mira + seleção ---
    if (aimSource) {
        const pose = this._getXrPose(aimSource);
        if (pose) {
            this.app.fire('xr:pose', {
                source:    aimSource,
                origin:    pose.origin,
                direction: pose.direction
            });
        }

        const trigger = this._readXrButton(aimSource, 0) || Boolean(aimSource.selecting);
        if (trigger !== this._xrTriggerWasPressed) {
            this.app.fire('xr:trigger', { source: aimSource, pressed: trigger });
            this._xrTriggerWasPressed = trigger;
        }

        const clear = this._readXrButton(aimSource, 1) || this._readXrButton(aimSource, 4);
        if (clear && !this._xrClearWasPressed) {
            this.app.fire('xr:clear');
        }
        this._xrClearWasPressed = clear;

        const cycle = this._readXrButton(aimSource, 2) || this._readXrButton(aimSource, 5);
        if (cycle && !this._xrCycleWasPressed) {
            this.app.fire('xr:cycle-op');
        }
        this._xrCycleWasPressed = cycle;
    }

    // --- Controlador esquerdo: locomoção ---
    if (navSource && this._rig) {
        const [stickX, stickZ] = this._readNavAxes(navSource);

        if (Math.abs(stickX) > 0.001 || Math.abs(stickZ) > 0.001) {
            const cam = this._getCameraEntity();
            if (cam) {
                const forward = cam.forward.clone();
                const right   = cam.right.clone();
                forward.y = 0; forward.normalize();
                right.y   = 0; right.normalize();

                const move = new pc.Vec3();
                move.addScaled(right,    stickX * this.speed * dt);
                move.addScaled(forward, -stickZ * this.speed * dt);
                this._rig.translate(move);

                this.app.fire('xr:navigate', { dx: stickX, dz: stickZ });
            }
        }
    }
};

// ---------------------------------------------------------------------------
// API pública: gestão de sessão XR
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype.startSession = function (type, space) {
    type  = type  ?? 'immersive-vr';
    space = space ?? 'local-floor';

    return new Promise((resolve, reject) => {
        const xr = this.app.xr;
        if (!xr) { reject(new Error('[VrStudioPlugin] XR manager não disponível')); return; }

        const cam = this._getCameraEntity();
        if (!cam) { reject(new Error('[VrStudioPlugin] Nenhuma câmera encontrada')); return; }

        const xrType  = type  === 'immersive-vr'  ? pc.XRTYPE_VR         : type;
        const xrSpace = space === 'local-floor'    ? pc.XRSPACE_LOCALFLOOR : space;

        if (typeof xr.isAvailable === 'function' && !xr.isAvailable(xrType)) {
            reject(new Error(`[VrStudioPlugin] Sessão XR indisponível para tipo "${xrType}"`));
            return;
        }

        xr.start(cam.camera, xrType, xrSpace, {
            callback: (err) => {
                if (err) { reject(err); }
                else     { resolve({ ok: true, active: true }); }
            }
        });
    });
};

VrStudioPlugin.prototype.endSession = function () {
    if (this.app.xr?.active) this.app.xr.end();
    return { ok: true };
};

VrStudioPlugin.prototype.toggleVR = function () {
    if (this.app.xr?.active) {
        this.endSession();
    } else {
        this.startSession().catch((err) => {
            console.warn('[VrStudioPlugin] toggleVR:', err.message);
        });
    }
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

VrStudioPlugin.prototype.destroy = function () {
    if (this._keydownHandler) {
        window.removeEventListener('keydown', this._keydownHandler);
        this._keydownHandler = null;
    }
    document.getElementById('btn-vr-studio')?.remove();
};

// ---------------------------------------------------------------------------
// Factory / bootstrapper
// ---------------------------------------------------------------------------

/**
 * Registra o VrStudioPlugin no Script Registry do PlayCanvas e retorna a classe.
 * @param {pc.AppBase} app - instância da aplicação (não usado internamente, mas
 *                           mantido para consistência de API e futuros hooks).
 * @returns {typeof VrStudioPlugin}
 */
export function initVRPlugin(app) { // eslint-disable-line no-unused-vars
    pc.registerScript(VrStudioPlugin, 'vrStudio');
    return VrStudioPlugin;
}
