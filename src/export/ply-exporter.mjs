import * as pc from 'playcanvas';

/**
 * Exports splats to a binary little-endian PLY, applying the committed edits.
 *
 * Output is in WORLD space (entity placement baked in) so multiple selectables
 * merge into one consistent coordinate frame. The same math as the work-buffer
 * modifier is replayed on the CPU over the original (decompressed) splat data:
 *   posOut   = t + s · rot(q, M · posLocal)
 *   rotOut   = qEdit ⊗ (qEntity ⊗ qLocal)
 *   scaleOut = log( entityScale · exp(scaleLocalLog) · sEdit )   (per axis)
 *   colorOut = override ? (rgb−0.5)/SH_C0 : f_dc_local
 *
 * Scope 'subset' keeps only splats with selectionMask > 0; 'whole' keeps all.
 *
 * Limitations (documented): DC color only (higher-order SH is dropped), and a
 * uniform entity/edit scale is assumed (true for this app's placements).
 */

const SH_C0 = 0.28209479177387814;

// PLY property order (must match the write order below).
const PROPS = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const STRIDE = PROPS.length; // floats per vertex

// Resolve a CPU GSplatData (with getProp) for a resource, decompressing if needed.
async function resolveSplatData(selectable) {
    if (selectable._cpuData) return selectable._cpuData;
    const gd = selectable.resource?.gsplatData;
    let data = null;
    if (gd && typeof gd.getProp === 'function' && gd.getProp('x')) {
        data = gd; // uncompressed PLY
    } else if (gd && typeof gd.decompress === 'function') {
        data = await gd.decompress(); // compressed / SOG (await handles sync + async)
    }
    selectable._cpuData = data;
    return data;
}

/**
 * @param {object} args
 * @param {object} args.system - selection system (has `selectables`)
 * @param {object} args.editSystem - edit system (provides `getEditedMirror`)
 * @param {'subset'|'whole'} args.scope
 */
export async function exportPly({ system, editSystem, scope }) {
    const qEntity = new pc.Quat();
    const qBase = new pc.Quat();
    const qWorld = new pc.Quat();
    const qEdit = new pc.Quat();
    const qOut = new pc.Quat();
    const p = new pc.Vec3();

    // Gather per-selectable data + included index lists.
    const parts = [];
    let total = 0;
    for (const s of system.selectables) {
        if (!s.entity.enabled) continue;
        const data = await resolveSplatData(s);
        if (!data) {
            console.warn(`[export] sem dados CPU para "${s.entity.name}", pulando`);
            continue;
        }
        let indices;
        if (scope === 'subset') {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            const mask = await tex.read(0, 0, tex.width, tex.height);
            indices = [];
            for (let i = 0; i < s.numSplats; i++) if (mask[i] > 127) indices.push(i);
        } else {
            indices = null; // all splats
        }
        const count = indices ? indices.length : s.numSplats;
        if (count === 0) continue;
        total += count;
        parts.push({ s, data, indices, count });
    }

    if (total === 0) {
        console.warn('[export] nada para exportar');
        return { count: 0 };
    }

    // Allocate output buffer.
    const out = new Float32Array(total * STRIDE);
    let w = 0;

    for (const { s, data, indices, count } of parts) {
        const x = data.getProp('x'), y = data.getProp('y'), z = data.getProp('z');
        const r0 = data.getProp('rot_0'), r1 = data.getProp('rot_1'), r2 = data.getProp('rot_2'), r3 = data.getProp('rot_3');
        const sc0 = data.getProp('scale_0'), sc1 = data.getProp('scale_1'), sc2 = data.getProp('scale_2');
        const c0 = data.getProp('f_dc_0'), c1 = data.getProp('f_dc_1'), c2 = data.getProp('f_dc_2');
        const op = data.getProp('opacity');

        const wm = s.entity.getWorldTransform();
        qEntity.copy(s.entity.getRotation());
        const es = s.entity.getScale();
        const logEsX = Math.log(es.x), logEsY = Math.log(es.y), logEsZ = Math.log(es.z);
        const m = editSystem.getEditedMirror(s);

        const n = indices ? indices.length : s.numSplats;
        for (let j = 0; j < n; j++) {
            const i = indices ? indices[j] : j;
            const k = i * 4;
            const sEdit = m.ts[k + 3];
            const logSEdit = Math.log(sEdit);

            // position: edited = t + s · rot(q, M · base)
            p.set(x[i], y[i], z[i]);
            wm.transformPoint(p, p);
            qEdit.set(m.quat[k], m.quat[k + 1], m.quat[k + 2], m.quat[k + 3]);
            qEdit.transformVector(p, p);
            const ox = m.ts[k] + sEdit * p.x;
            const oy = m.ts[k + 1] + sEdit * p.y;
            const oz = m.ts[k + 2] + sEdit * p.z;

            // rotation: qEdit ⊗ (qEntity ⊗ qBase)
            qBase.set(r1 ? r1[i] : 0, r2 ? r2[i] : 0, r3 ? r3[i] : 0, r0 ? r0[i] : 1);
            qWorld.mul2(qEntity, qBase);
            qOut.mul2(qEdit, qWorld);

            // color override?
            let f0, f1, f2;
            if (m.color[k + 3] > 127) {
                f0 = (m.color[k] / 255 - 0.5) / SH_C0;
                f1 = (m.color[k + 1] / 255 - 0.5) / SH_C0;
                f2 = (m.color[k + 2] / 255 - 0.5) / SH_C0;
            } else {
                f0 = c0 ? c0[i] : 0; f1 = c1 ? c1[i] : 0; f2 = c2 ? c2[i] : 0;
            }

            out[w++] = ox;
            out[w++] = oy;
            out[w++] = oz;
            out[w++] = f0;
            out[w++] = f1;
            out[w++] = f2;
            out[w++] = op ? op[i] : 0;
            out[w++] = (sc0 ? sc0[i] : 0) + logEsX + logSEdit;
            out[w++] = (sc1 ? sc1[i] : 0) + logEsY + logSEdit;
            out[w++] = (sc2 ? sc2[i] : 0) + logEsZ + logSEdit;
            out[w++] = qOut.w; // rot_0
            out[w++] = qOut.x; // rot_1
            out[w++] = qOut.y; // rot_2
            out[w++] = qOut.z; // rot_3
        }
    }

    // Build header + body and trigger a download.
    const header =
        'ply\n' +
        'format binary_little_endian 1.0\n' +
        'comment exported by splatting-paint (world space, DC color only)\n' +
        `element vertex ${total}\n` +
        PROPS.map(name => `property float ${name}`).join('\n') + '\n' +
        'end_header\n';
    const headerBytes = new TextEncoder().encode(header);

    const blob = new Blob([headerBytes, out.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selection-${scope}.ply`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log(`[export] ${total} splats → selection-${scope}.ply`);
    return { count: total };
}
