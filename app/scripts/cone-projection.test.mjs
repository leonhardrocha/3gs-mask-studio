import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    forwardFromQuaternion,
    rayDirectionFromNearFar
} from './cone-projection-utils.mjs';

const almost = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('cone projection consistency', () => {
    it('computes screen ray direction from near/far points', () => {
        const dir = rayDirectionFromNearFar(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: -5 }
        );

        assert.equal(almost(dir.x, 0), true);
        assert.equal(almost(dir.y, 0), true);
        assert.equal(almost(dir.z, -1), true);
    });

    it('computes XR forward from quaternion', () => {
        const identityForward = forwardFromQuaternion({ x: 0, y: 0, z: 0, w: 1 });
        assert.equal(almost(identityForward.x, 0), true);
        assert.equal(almost(identityForward.y, 0), true);
        assert.equal(almost(identityForward.z, -1), true);

        const yaw90 = Math.PI * 0.5;
        const half = yaw90 * 0.5;
        const q = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
        const forward = forwardFromQuaternion(q);

        assert.equal(almost(forward.x, -1), true);
        assert.equal(almost(forward.y, 0), true);
        assert.equal(almost(forward.z, 0), true);
    });

    it('matches desktop and XR directions for equivalent aim', () => {
        const xrForward = forwardFromQuaternion({ x: 0, y: 0, z: 0, w: 1 });
        const near = { x: 1, y: 2, z: 3 };
        const far = {
            x: near.x + xrForward.x * 8,
            y: near.y + xrForward.y * 8,
            z: near.z + xrForward.z * 8
        };

        const desktop = rayDirectionFromNearFar(near, far);
        assert.equal(almost(desktop.x, xrForward.x), true);
        assert.equal(almost(desktop.y, xrForward.y), true);
        assert.equal(almost(desktop.z, xrForward.z), true);
    });
});
