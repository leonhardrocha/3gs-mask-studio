import * as pc from 'playcanvas';

/**
 * XR locomotion (controllers only) — moves the camera rig (`cameraParent`),
 * never the camera (the engine writes the HMD pose into the camera).
 *
 * Fluid, conflict-free scheme (the right stick is movement-only, no brush role):
 *   - Left thumbstick:  Y = forward/back (head-facing, horizontal), X = strafe.
 *   - Right thumbstick: X = smooth continuous yaw (pivots around the head),
 *                       Y = vertical (up/down).
 *
 * Hand/grab world manipulation is intentionally out of scope (see ARCHITECTURE.md).
 */
export function createLocomotion({ camera, cameraParent }) {
    const fwd = new pc.Vec3();
    const right = new pc.Vec3();
    const move = new pc.Vec3();
    const head = new pc.Vec3();
    const offset = new pc.Vec3();
    const turnQuat = new pc.Quat();

    const TURN_SPEED = 90;   // degrees / second (smooth yaw)
    const DEADZONE = 0.15;

    // Rotate the rig around the head's world position by angleDeg (smooth yaw).
    const yaw = (angleDeg) => {
        head.copy(camera.getPosition());
        offset.copy(cameraParent.getPosition()).sub(head); // P − H
        turnQuat.setFromEulerAngles(0, angleDeg, 0);
        turnQuat.transformVector(offset, offset);          // R·(P − H)
        cameraParent.setPosition(head.x + offset.x, head.y + offset.y, head.z + offset.z);
        cameraParent.rotate(0, angleDeg, 0);
    };

    const update = ({ leftSource, rightSource, dt, data }) => {
        const speed = (data.get('xrMoveSpeed') ?? 1.5) * dt;

        // --- left stick: planar move ---
        const lpad = leftSource?.gamepad;
        if (lpad && lpad.axes.length > 3) {
            const lx = lpad.axes[2] ?? 0;
            const ly = lpad.axes[3] ?? 0;
            if (Math.abs(lx) > DEADZONE || Math.abs(ly) > DEADZONE) {
                fwd.copy(camera.forward); fwd.y = 0;
                if (fwd.lengthSq() > 1e-6) fwd.normalize();
                right.copy(camera.right); right.y = 0;
                if (right.lengthSq() > 1e-6) right.normalize();
                move.set(
                    fwd.x * (-ly) + right.x * lx,
                    0,
                    fwd.z * (-ly) + right.z * lx
                );
                cameraParent.translate(move.x * speed, move.y * speed, move.z * speed);
            }
        }

        // --- right stick: X = smooth yaw, Y = vertical ---
        const rpad = rightSource?.gamepad;
        if (rpad && rpad.axes.length > 3) {
            const rx = rpad.axes[2] ?? 0;
            const ry = rpad.axes[3] ?? 0;
            if (Math.abs(rx) > DEADZONE) yaw(-rx * TURN_SPEED * dt);
            if (Math.abs(ry) > DEADZONE) cameraParent.translate(0, -ry * speed, 0);
        }
    };

    return { update };
}
