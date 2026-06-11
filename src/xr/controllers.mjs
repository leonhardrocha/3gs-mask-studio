import * as pc from 'playcanvas';

/**
 * XR controller proxies + ray visualization.
 *
 * Each controller is an entity parented to the camera rig (`cameraParent`), posed
 * (scale 1) from the input source's grip transform. It carries a small placeholder
 * box as a CHILD (`fallbackBox`) — a high-fidelity Input-Profiles model
 * (`controller-models.mjs`) parents alongside it and hides the box once loaded.
 * Keeping the box a child (not the entity's own scaled render) means the model is
 * NOT inherited-scaled. A pointer ray is drawn in world space, colored by action:
 *   white = idle, green = trigger (select), cyan = grip (navigate).
 */
export function createControllerEntity({ cameraParent, inputSource }) {
    const entity = new pc.Entity('xr-controller');
    cameraParent.addChild(entity);
    entity.inputSource = inputSource;

    // Placeholder box (fallback until a profile model attaches), as a child so its
    // scale doesn't propagate to the loaded glTF model.
    const box = new pc.Entity('xr-controller-box');
    box.addComponent('render', { type: 'box' });
    box.setLocalScale(0.04, 0.04, 0.12);
    entity.addChild(box);
    entity.fallbackBox = box;

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
