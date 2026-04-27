/**
 * input-pointer.mjs
 *
 * Camada unificada de entrada para seleção por cone.
 * Suporta desktop (gamepad), XR (controladores) e fallback de teclado/câmera.
 */

import * as pc from '../../engine/build/playcanvas.mjs';
import {
    applyDeadZone,
    clampVirtualCursor,
    resolveOperation
} from './input-pointer-utils.mjs';

const INPUT_MODE = {
    AUTO: 'auto',
    GAMEPAD: 'gamepad',
    XR: 'xr'
};

class PointerInputAdapter {
    constructor(entity, app, mode = INPUT_MODE.AUTO) {
        this.entity = entity;
        this.app = app;
        this.mode = mode;

        this._virtualX = 0;
        this._virtualY = 0;
        this._virtualReady = false;
        this._virtualDeltaX = 0;
        this._virtualDeltaY = 0;

        this._cursorSpeedPxPerFrame = 22;
        this._rangeDeltaAccum = 0;

        this._xrSource = null;
        this._operation = 'set';
        this._isSelectPressed = false;
        this._wasPressed = false;
        this._didRelease = false;
        this._activeSourceType = 'keyboard-fallback';

        this._onXrAdd = null;
        this._onXrRemove = null;

        this._bindEvents();
    }

    destroy() {
        if (this.app?.xr?.input) {
            if (this._onXrAdd) this.app.xr.input.off('add', this._onXrAdd, this);
            if (this._onXrRemove) this.app.xr.input.off('remove', this._onXrRemove, this);
        }
    }

    setMode(mode) {
        if (mode === 'mouse') {
            this.mode = INPUT_MODE.GAMEPAD;
            return;
        }
        this.mode = Object.values(INPUT_MODE).includes(mode) ? mode : INPUT_MODE.AUTO;
    }

    getMode() {
        return this.mode;
    }

    update(dt = 1 / 60) {
        if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;

        const sourceType = this._resolveSourceType();
        const frameInput = this._readFrameInput(sourceType);

        this._operation = resolveOperation(frameInput.addPressed, frameInput.removePressed);
        this._isSelectPressed = frameInput.selectPressed;

        this._didRelease = !this._isSelectPressed && this._wasPressed;
        this._wasPressed = this._isSelectPressed;

        const rangeAxis = applyDeadZone(frameInput.rangeAxis, 0.18);
        if (rangeAxis !== 0) {
            this._rangeDeltaAccum += (-rangeAxis) * dt * 10;
        }

        if (sourceType === 'gamepad') {
            this._applyVirtualCursorFrame(frameInput.stickX, frameInput.stickY);
        } else {
            this._virtualDeltaX = 0;
            this._virtualDeltaY = 0;
        }
    }

    didSelectRelease() {
        return this._didRelease;
    }

    isSelectPressed() {
        return this._isSelectPressed;
    }

    getOperation() {
        return this._operation;
    }

    getVirtualCursorDelta() {
        return {
            x: this._virtualDeltaX,
            y: this._virtualDeltaY
        };
    }

    getVirtualCursorPosition() {
        if (!this._virtualReady) {
            const device = this.app?.graphicsDevice;
            const width = Math.max(1, device?.width ?? 1);
            const height = Math.max(1, device?.height ?? 1);
            return {
                x: width * 0.5,
                y: height * 0.5,
                active: false
            };
        }

        return {
            x: this._virtualX,
            y: this._virtualY,
            active: this._activeSourceType === 'gamepad'
        };
    }

    pulseFeedback(intensity = 0.35, duration = 45) {
        const sourceType = this._activeSourceType;

        if (sourceType === 'gamepad') {
            const pad = this._getDesktopGamepad();
            if (pad?.pulse) {
                return pad.pulse(intensity, duration);
            }
            return Promise.resolve(false);
        }

        if (sourceType === 'xr-left' || sourceType === 'xr-right') {
            const src = this._getXrSource();
            const gp = src?.gamepad;
            const actuators = gp?.hapticActuators || [];
            if (actuators.length && typeof actuators[0]?.pulse === 'function') {
                return actuators[0].pulse(intensity, duration);
            }
        }

        return Promise.resolve(false);
    }

    consumeRangeDelta(step = 0.1) {
        if (!Number.isFinite(step) || step <= 0) step = 0.1;
        if (this._rangeDeltaAccum === 0) return 0;
        const delta = this._rangeDeltaAccum * step;
        this._rangeDeltaAccum = 0;
        return delta;
    }

    getPose() {
        const sourceType = this._resolveSourceType();

        if (sourceType === 'xr-left' || sourceType === 'xr-right') {
            const src = this._getXrSource();
            if (src) {
                const origin = src.getPosition();
                const rot = src.getRotation();
                const direction = new pc.Vec3(0, 0, -1);
                const q = new pc.Quat(rot.x, rot.y, rot.z, rot.w);
                q.transformVector(direction, direction);
                direction.normalize();
                return { origin, direction, sourceType };
            }
        }

        if (sourceType === 'gamepad') {
            const camera = this.entity?.camera;
            if (camera && this.app?.graphicsDevice) {
                const width = this.app.graphicsDevice.width;
                const height = this.app.graphicsDevice.height;

                if (!this._virtualReady) {
                    this._virtualX = width * 0.5;
                    this._virtualY = height * 0.5;
                    this._virtualReady = true;
                }

                const sx = this._virtualX;
                const sy = this._virtualY;

                const near = camera.screenToWorld(sx, sy, camera.nearClip);
                const far = camera.screenToWorld(sx, sy, camera.farClip);
                const direction = far.clone().sub(near).normalize();

                return {
                    origin: near,
                    direction,
                    sourceType
                };
            }
        }

        const origin = this.entity.getPosition().clone();
        const direction = new pc.Vec3();
        this.entity.getWorldTransform().getZ(direction);
        direction.scale(-1).normalize();
        return { origin, direction, sourceType };
    }

    getSourceType() {
        return this._activeSourceType;
    }

    _bindEvents() {
        if (this.app?.xr?.input) {
            this._onXrAdd = (src) => {
                if (!this._xrSource) this._xrSource = src;
            };
            this._onXrRemove = (src) => {
                if (this._xrSource === src) this._xrSource = null;
            };
            this.app.xr.input.on('add', this._onXrAdd, this);
            this.app.xr.input.on('remove', this._onXrRemove, this);
        }
    }

    _resolveSourceType() {
        const hasDesktopPad = Boolean(this._getDesktopGamepad() && this.entity?.camera);
        const xrSource = this._getXrSource();
        const xrActive = Boolean(this.app?.xr?.active);

        if (this.mode === INPUT_MODE.XR) {
            if (xrSource) {
                const h = String(xrSource.handedness || '').toLowerCase();
                this._activeSourceType = h === 'left' ? 'xr-left' : 'xr-right';
                return this._activeSourceType;
            }
            this._activeSourceType = xrActive ? 'hmd' : 'keyboard-fallback';
            return this._activeSourceType;
        }

        if (this.mode === INPUT_MODE.GAMEPAD) {
            this._activeSourceType = hasDesktopPad ? 'gamepad' : 'keyboard-fallback';
            return this._activeSourceType;
        }

        if (xrSource) {
            const h = String(xrSource.handedness || '').toLowerCase();
            this._activeSourceType = h === 'left' ? 'xr-left' : 'xr-right';
            return this._activeSourceType;
        }
        if (xrActive) {
            this._activeSourceType = 'hmd';
            return this._activeSourceType;
        }
        if (hasDesktopPad) {
            this._activeSourceType = 'gamepad';
            return this._activeSourceType;
        }

        this._activeSourceType = 'keyboard-fallback';
        return this._activeSourceType;
    }

    _getXrSource() {
        if (this._xrSource) return this._xrSource;
        const input = this.app?.xr?.input;
        if (!input) return null;
        const sources = input.inputSources || [];
        if (!sources.length) return null;

        const right = sources.find((s) => String(s.handedness || '').toLowerCase() === 'right');
        const left = sources.find((s) => String(s.handedness || '').toLowerCase() === 'left');
        return right || left || sources[0] || null;
    }

    _getDesktopGamepad() {
        const gamepads = this.app?.gamepads;
        const current = gamepads?.current;
        if (!current || !current.length) return null;
        return current[0] || null;
    }

    _readFrameInput(sourceType) {
        const spaceDown = this.app?.keyboard?.isPressed(pc.KEY_SPACE) ?? false;

        if (sourceType === 'gamepad') {
            const pad = this._getDesktopGamepad();
            const stickX = pad ? applyDeadZone(pad.getAxis(pc.PAD_R_STICK_X), 0.2) : 0;
            const stickY = pad ? applyDeadZone(pad.getAxis(pc.PAD_R_STICK_Y), 0.2) : 0;
            const rangeAxis = pad ? applyDeadZone(pad.getAxis(pc.PAD_L_STICK_Y), 0.2) : 0;

            const addPressed = Boolean(pad?.isPressed(pc.PAD_FACE_1));
            const removePressed = Boolean(pad?.isPressed(pc.PAD_FACE_2));
            const setPressed = Boolean(pad?.isPressed(pc.PAD_FACE_3));
            const selectPressed = addPressed || removePressed || setPressed;

            return {
                stickX,
                stickY,
                rangeAxis,
                addPressed,
                removePressed,
                selectPressed
            };
        }

        if (sourceType === 'xr-left' || sourceType === 'xr-right') {
            const src = this._getXrSource();
            const gp = src?.gamepad || null;

            // Cross-profile fallback mapping:
            // trigger/select: 0
            // add: A/X or squeeze: 1 or 4
            // remove: B/Y or secondary squeeze/menu: 2 or 5
            const addPressed = this._xrButtonPressed(src, gp, 1) || this._xrButtonPressed(src, gp, 4);
            const removePressed = this._xrButtonPressed(src, gp, 2) || this._xrButtonPressed(src, gp, 5);
            const triggerPressed = this._xrButtonPressed(src, gp, 0) || Boolean(src?.selecting);

            let rangeAxis = 0;
            if (gp?.axes?.length) {
                // Use the best available vertical axis from thumbstick/touchpad.
                if (gp.axes.length >= 4) {
                    rangeAxis = Number(gp.axes[3] ?? 0);
                } else if (gp.axes.length >= 2) {
                    rangeAxis = Number(gp.axes[1] ?? 0);
                }
            }

            return {
                stickX: 0,
                stickY: 0,
                rangeAxis,
                addPressed,
                removePressed,
                selectPressed: triggerPressed || addPressed || removePressed
            };
        }

        return {
            stickX: 0,
            stickY: 0,
            rangeAxis: 0,
            addPressed: false,
            removePressed: false,
            selectPressed: Boolean(spaceDown)
        };
    }

    _xrButtonPressed(src, gamepad, index) {
        if (src && typeof src.getButton === 'function') {
            const v = src.getButton(index);
            if (typeof v === 'boolean') return v;
            if (typeof v === 'number') return v > 0.5;
        }

        const btn = gamepad?.buttons?.[index];
        if (!btn) return false;
        if (typeof btn === 'number') return btn > 0.5;
        if (typeof btn.pressed === 'boolean') return btn.pressed;
        return Number(btn.value ?? 0) > 0.5;
    }

    _applyVirtualCursorFrame(stickX, stickY) {
        const device = this.app?.graphicsDevice;
        if (!device) return;

        const width = Math.max(1, device.width);
        const height = Math.max(1, device.height);

        if (!this._virtualReady) {
            this._virtualX = width * 0.5;
            this._virtualY = height * 0.5;
            this._virtualReady = true;
        }

        const dx = stickX * this._cursorSpeedPxPerFrame;
        const dy = stickY * this._cursorSpeedPxPerFrame;

        const next = clampVirtualCursor(
            this._virtualX + dx,
            this._virtualY + dy,
            width,
            height
        );

        this._virtualDeltaX = next.x - this._virtualX;
        this._virtualDeltaY = next.y - this._virtualY;
        this._virtualX = next.x;
        this._virtualY = next.y;
    }
}

export {
    INPUT_MODE,
    PointerInputAdapter
};
