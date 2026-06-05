import * as pc from 'playcanvas';

/**
 * Edit system — applies move / rotate / uniform-scale / recolor to the current
 * selection, with live GPU preview and a committed, stackable result.
 *
 * Model (hybrid edit-list): the ACTIVE operation is previewed on the GPU via the
 * modifier uniforms (`uActive*`). On commit, the operation is folded into a
 * per-splat SIMILARITY transform stored in a CPU mirror and uploaded to the
 * `editQuat` / `editTS` / `editColor` streams. The mirror is the accumulated
 * edit-list and is the source of truth for PLY export.
 *
 * Per-splat stored transform maps the base (unedited) world center to:
 *   editedCenter = t + s * rot(q, baseCenter)
 * Composition of a new op (rotation Ra, uniform scale sa, translate ta about
 * pivot P) over the existing {q, t, s}:
 *   q' = Ra ⊗ q
 *   s' = sa · s
 *   t' = P + sa · Ra·(t − P) + ta
 * No base splat data is needed on the CPU (the GPU supplies it), so this works
 * for compressed and SOG sources too.
 */
export function createEditSystem({ system, data }) {
    const pivot = new pc.Vec3();

    // reusable temporaries
    const Ra = new pc.Quat();
    const qi = new pc.Quat();
    const qn = new pc.Quat();
    const ti = new pc.Vec3();
    const ta = new pc.Vec3();
    const tmpV = new pc.Vec3();
    const tmpC = new pc.Vec3();
    const mq = new pc.Quat();

    const activeQuat = () => Ra.setFromEulerAngles(data.get('editRx'), data.get('editRy'), data.get('editRz'));

    const getMirror = (s) => {
        if (!s._mirror) {
            const n = s.numSplats;
            const quat = new Float32Array(n * 4);
            const ts = new Float32Array(n * 4);
            const color = new Uint8Array(n * 4);
            for (let i = 0; i < n; i++) {
                quat[i * 4 + 3] = 1; // identity rotation
                ts[i * 4 + 3] = 1;   // unit scale
            }
            s._mirror = { quat, ts, color };
        }
        return s._mirror;
    };

    const pushPreview = () => {
        const editing = !!data.get('editing');
        const q = activeQuat();
        const tsParam = [data.get('editTx'), data.get('editTy'), data.get('editTz'), data.get('editScale')];
        const col = data.get('editColor') ?? [1, 1, 1];
        const colParam = data.get('editColorEnabled') ? [col[0], col[1], col[2], 1] : [0, 0, 0, 0];
        for (const s of system.selectables) {
            const c = s.gsplatComponent;
            c.setParameter('uHasActiveOp', editing ? 1 : 0);
            c.setParameter('uActiveQuat', [q.x, q.y, q.z, q.w]);
            c.setParameter('uActiveTS', tsParam);
            c.setParameter('uActivePivot', [pivot.x, pivot.y, pivot.z]);
            c.setParameter('uActiveColor', colParam);
            s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
        }
    };

    // Pivot = centroid of the currently selected splats (world space).
    const recomputePivot = async () => {
        const sum = new pc.Vec3();
        let count = 0;
        for (const s of system.selectables) {
            if (!s.entity.enabled) continue;
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const mask = await tex.read(0, 0, tex.width, tex.height);
            const centers = s.resource?.gsplatData?.getCenters?.();
            const wm = s.entity.getWorldTransform();
            const m = getMirror(s);
            const n = s.numSplats;
            if (centers) {
                for (let i = 0; i < n; i++) {
                    if (mask[i] > 127) {
                        // base world center, then apply committed edit (t + s·rot(q, base))
                        tmpC.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
                        wm.transformPoint(tmpC, tmpC);
                        const k = i * 4;
                        mq.set(m.quat[k], m.quat[k + 1], m.quat[k + 2], m.quat[k + 3]);
                        mq.transformVector(tmpC, tmpC);
                        const sc = m.ts[k + 3];
                        sum.x += m.ts[k] + sc * tmpC.x;
                        sum.y += m.ts[k + 1] + sc * tmpC.y;
                        sum.z += m.ts[k + 2] + sc * tmpC.z;
                        count++;
                    }
                }
            } else {
                // Fallback (no CPU centers, e.g. some compressed formats): use entity origin.
                for (let i = 0; i < n; i++) {
                    if (mask[i] > 127) { sum.add(s.entity.getPosition()); count++; break; }
                }
            }
        }
        if (count > 0) pivot.copy(sum).mulScalar(1 / count);
        pushPreview();
    };

    const uploadMirror = (s, includeColor) => {
        const m = s._mirror;
        const eq = s.gsplatComponent.getInstanceTexture('editQuat');
        const qd = eq.lock(); qd.set(m.quat); eq.unlock();
        const et = s.gsplatComponent.getInstanceTexture('editTS');
        const td = et.lock(); td.set(m.ts); et.unlock();
        if (includeColor) {
            const ec = s.gsplatComponent.getInstanceTexture('editColor');
            const cd = ec.lock(); cd.set(m.color); ec.unlock();
        }
    };

    // Fold the active operation into every selected splat's stored transform.
    const commit = async () => {
        const ra = activeQuat().clone();
        const sa = data.get('editScale');
        ta.set(data.get('editTx'), data.get('editTy'), data.get('editTz'));
        const P = pivot;
        const colEnabled = !!data.get('editColorEnabled');
        const col = data.get('editColor') ?? [1, 1, 1];
        const cr = Math.round(col[0] * 255), cg = Math.round(col[1] * 255), cb = Math.round(col[2] * 255);

        for (const s of system.selectables) {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const mask = await tex.read(0, 0, tex.width, tex.height);
            const m = getMirror(s);
            const n = s.numSplats;
            let touched = false;
            for (let i = 0; i < n; i++) {
                if (mask[i] <= 127) continue;
                touched = true;
                const k = i * 4;
                // q' = Ra ⊗ qi
                qi.set(m.quat[k], m.quat[k + 1], m.quat[k + 2], m.quat[k + 3]);
                qn.mul2(ra, qi);
                m.quat[k] = qn.x; m.quat[k + 1] = qn.y; m.quat[k + 2] = qn.z; m.quat[k + 3] = qn.w;
                // t' = P + sa·Ra·(ti − P) + ta ; s' = sa·si
                ti.set(m.ts[k], m.ts[k + 1], m.ts[k + 2]);
                const si = m.ts[k + 3];
                tmpV.sub2(ti, P);
                ra.transformVector(tmpV, tmpV);
                tmpV.mulScalar(sa);
                m.ts[k] = P.x + tmpV.x + ta.x;
                m.ts[k + 1] = P.y + tmpV.y + ta.y;
                m.ts[k + 2] = P.z + tmpV.z + ta.z;
                m.ts[k + 3] = sa * si;
                if (colEnabled) {
                    m.color[k] = cr; m.color[k + 1] = cg; m.color[k + 2] = cb; m.color[k + 3] = 255;
                }
            }
            if (touched) {
                uploadMirror(s, colEnabled);
                s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
            }
        }
        reset();
    };

    // Reset the active op back to identity (keeps `editing` on).
    const reset = () => {
        data.set('editTx', 0); data.set('editTy', 0); data.set('editTz', 0);
        data.set('editRx', 0); data.set('editRy', 0); data.set('editRz', 0);
        data.set('editScale', 1);
        data.set('editColorEnabled', false);
        pushPreview();
    };

    // Expose mirrors for the PLY exporter.
    const getEditedMirror = (s) => getMirror(s);

    // --- wiring -------------------------------------------------------------
    const previewFields = ['editTx', 'editTy', 'editTz', 'editRx', 'editRy', 'editRz', 'editScale', 'editColor', 'editColorEnabled'];
    for (const f of previewFields) data.on(`${f}:set`, pushPreview);
    data.on('editing:set', () => {
        if (data.get('editing')) recomputePivot();
        else pushPreview();
    });
    data.on('commitEdit', () => { commit(); });
    data.on('resetEdit', () => reset());
    data.on('recomputePivot', () => { recomputePivot(); });

    pushPreview();

    return { pushPreview, recomputePivot, commit, reset, getEditedMirror, getPivot: () => pivot };
}
