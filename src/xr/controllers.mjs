import * as pc from 'playcanvas';

/**
 * XR controller proxies + ray visualization.
 *
 * Each controller is a small box entity parented to the camera rig
 * (`cameraParent`), posed from the input source's rig-local transform. A pointer
 * ray is drawn in world space (immediate mode), colored by the current action:
 *   white = idle, green = trigger (select), cyan = grip (navigate, phase 4).
 *
 * Adapted from the engine's `lctgs.hands.mjs` example (controller path only).
 */
export function createControllerEntity({ cameraParent, inputSource }) {
    const entity = new pc.Entity('xr-controller');
    entity.addComponent('render', { type: 'box' });
    entity.setLocalScale(0.04, 0.04, 0.12);
    cameraParent.addChild(entity);
    entity.inputSource = inputSource;
    return entity;
}

const rayEnd = new pc.Vec3();

export function updateControllers({ app, controllers, rayVisible = true, rayLength = 5 }) {
    for (const entity of controllers) {
        const src = entity.inputSource;
        if (src.grip) {
            entity.enabled = true;
            entity.setLocalPosition(src.getLocalPosition());
            entity.setLocalRotation(src.getLocalRotation());
        } else {
            entity.enabled = false;
        }

        if (rayVisible && src.targetRayMode === pc.XRTARGETRAY_POINTER) {
            rayEnd.copy(src.getDirection()).mulScalar(rayLength).add(src.getOrigin());
            const color = src.selecting ? pc.Color.GREEN : (src.squeezing ? pc.Color.CYAN : pc.Color.WHITE);
            app.drawLine(src.getOrigin(), rayEnd, color);
        }
    }
}

/** Prefer the right-hand controller; fall back to the first available. */
export function getPreferredInputSource(controllers, handedness = pc.XRHAND_RIGHT) {
    for (const e of controllers) {
        if (e.inputSource?.handedness === handedness) return e.inputSource;
    }
    return controllers[0]?.inputSource;
}
