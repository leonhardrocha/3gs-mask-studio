const createMovementState = () => {
    return {
        movementSpeed: 1.5,
        rotateSpeed: 45,
        rotateThreshold: 0.5,
        rotateResetThreshold: 0.25,
        lastRotateValue: 0,
        v2a: new pc.Vec2(),
        v2b: new pc.Vec2(),
        v3a: new pc.Vec3()
    };
};

const updateMovementFromControllers = ({ controllers, cameraEntity, cameraParent, dt, movementState }) => {
    for (let i = 0; i < controllers.length; i++) {
        const inputSource = controllers[i].inputSource;
        if (!inputSource?.gamepad) {
            continue;
        }

        if (inputSource.handedness === pc.XRHAND_LEFT) {
            movementState.v2a.set(inputSource.gamepad.axes[2] ?? 0, inputSource.gamepad.axes[3] ?? 0);
            if (movementState.v2a.length()) {
                movementState.v2a.normalize();

                movementState.v2b.x = cameraEntity.forward.x;
                movementState.v2b.y = cameraEntity.forward.z;
                movementState.v2b.normalize();

                const rad = Math.atan2(movementState.v2b.x, movementState.v2b.y) - Math.PI / 2;
                const t = movementState.v2a.x * Math.sin(rad) - movementState.v2a.y * Math.cos(rad);
                movementState.v2a.y = movementState.v2a.y * Math.sin(rad) + movementState.v2a.x * Math.cos(rad);
                movementState.v2a.x = t;

                movementState.v2a.mulScalar(movementState.movementSpeed * dt);
                cameraParent.translate(movementState.v2a.x, 0, movementState.v2a.y);
            }
        } else if (inputSource.handedness === pc.XRHAND_RIGHT) {
            const rotate = -(inputSource.gamepad.axes[2] ?? 0);

            if (movementState.lastRotateValue > 0 && rotate < movementState.rotateResetThreshold) {
                movementState.lastRotateValue = 0;
            } else if (movementState.lastRotateValue < 0 && rotate > -movementState.rotateResetThreshold) {
                movementState.lastRotateValue = 0;
            }

            if (movementState.lastRotateValue === 0 && Math.abs(rotate) > movementState.rotateThreshold) {
                movementState.lastRotateValue = Math.sign(rotate);

                movementState.v3a.copy(cameraEntity.getLocalPosition());
                cameraParent.translateLocal(movementState.v3a);
                cameraParent.rotateLocal(0, Math.sign(rotate) * movementState.rotateSpeed, 0);
                cameraParent.translateLocal(movementState.v3a.mulScalar(-1));
            }
        }
    }
};

export { createMovementState, updateMovementFromControllers };
