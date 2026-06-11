import * as pc from 'playcanvas';

import { workBufferModifier } from '../workbuffer-modifier.mjs';

/**
 * Selection system — the "brush" no longer paints, it marks a per-splat selection
 * mask. Built on the same machinery as the paint example: a `GSplatProcessor`
 * writes an instance stream (`selectionMask`, R8) where the brush sphere covers
 * splats; the work-buffer modifier highlights selected splats.
 *
 * Additive vs subtractive accumulation is achieved with blend equations instead
 * of reading the mask back (a processor cannot read and write the same stream):
 *   - additive  → MAX blend, write 1 inside / 0 outside (selected stays selected)
 *   - subtractive → MIN blend, write 0 inside / 1 outside (deselect inside only)
 */

// Process shader: writes the selection mask for splats inside the brush sphere.
// The brush sphere is given in WORLD space, and the test uses each splat's EDITED
// world position (committed transform applied) so re-selecting hits splats where
// they currently appear, not their original location.
const selectionShader = {
    processGLSL: /* glsl */`
        uniform vec4 uBrushSphere;  // xyz = center (world space), w = radius
        uniform float uSelMode;     // 1 = additive, 0 = subtractive
        uniform mat4 uModelMatrix;  // entity world transform

        vec3 sp_rotq(vec4 q, vec3 v) {
            return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }

        void process() {
            vec3 baseWorld = (uModelMatrix * vec4(getCenter(), 1.0)).xyz;
            vec4 q = texelFetch(editQuat, splat.uv, 0);
            vec4 ts = texelFetch(editTS, splat.uv, 0);
            vec3 world = ts.xyz + ts.w * sp_rotq(q, baseWorld);
            float inside = step(distance(world, uBrushSphere.xyz), uBrushSphere.w);
            // additive: value = inside ; subtractive: value = 1 - inside
            float v = mix(1.0 - inside, inside, step(0.5, uSelMode));
            writeSelectionMask(vec4(v));
        }
    `,
    processWGSL: /* wgsl */`
        uniform uBrushSphere: vec4f;
        uniform uSelMode: f32;
        uniform uModelMatrix: mat4x4f;

        fn sp_rotq(q: vec4f, v: vec3f) -> vec3f {
            return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }

        fn process() {
            let baseWorld = (uniform.uModelMatrix * vec4f(getCenter(), 1.0)).xyz;
            let q = textureLoad(editQuat, splat.uv, 0);
            let ts = textureLoad(editTS, splat.uv, 0);
            let world = ts.xyz + ts.w * sp_rotq(q, baseWorld);
            let inside = step(distance(world, uniform.uBrushSphere.xyz), uniform.uBrushSphere.w);
            let v = mix(1.0 - inside, inside, step(0.5, uniform.uSelMode));
            writeSelectionMask(vec4f(v));
        }
    `
};

export const SELECT_ADDITIVE = 1;
export const SELECT_SUBTRACTIVE = 0;

export function createSelectionSystem({ app, device, data, history }) {
    /** @type {Array<{ entity, gsplatComponent, processor, maxLabel, numSplats }>} */
    const selectables = [];

    // Blend equations for mask accumulation (created once).
    const additiveBlend = new pc.BlendState(true, pc.BLENDEQUATION_MAX, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE);
    const subtractiveBlend = new pc.BlendState(true, pc.BLENDEQUATION_MIN, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE);

    const visibilityPathByName = {};
    const visibilityListenerPaths = new Set();

    const syncAssetVisibility = () => {
        for (const s of selectables) {
            const path = visibilityPathByName[s.entity.name];
            if (path) s.entity.enabled = !!data.get(path);
        }
    };

    const registerVisibilityItem = (entityName, label) => {
        if (visibilityPathByName[entityName]) return;
        const safeName = entityName.replace(/\W/g, '_');
        const path = `showAsset_${safeName}`;
        visibilityPathByName[entityName] = path;
        data.set(path, true);
        const items = data.get('assetVisibilityItems') ?? [];
        data.set('assetVisibilityItems', items.concat({ name: entityName, label, path }));
        if (!visibilityListenerPaths.has(path)) {
            visibilityListenerPaths.add(path);
            data.on(`${path}:set`, syncAssetVisibility);
        }
    };

    const applyHighlightParameters = (gsplatComponent) => {
        const c = data.get('selectionColor') ?? [1.0, 0.6, 0.0];
        gsplatComponent.setParameter('uSelHighlightColor', c);
        gsplatComponent.setParameter('uSelHighlightStrength', data.get('selectionStrength') ?? 0.7);
    };

    const applyLabelViewerParameters = (gsplatComponent, maxLabel = 1) => {
        gsplatComponent.setParameter('uLabelColoring', data.get('labelViewerEnabled') ? 1 : 0);
        gsplatComponent.setParameter('uLabelBlend', data.get('labelBlend') ?? 0.8);
        gsplatComponent.setParameter('uLabelMax', Math.max(1, maxLabel));
        gsplatComponent.setParameter('uLabelSatBandSize', 16);
        gsplatComponent.setParameter('uLabelColorMapMode', data.get('labelColorMapMode') === 'high-contrast' ? 1 : 0);
        const scheme = data.get('labelColorMapScheme');
        gsplatComponent.setParameter('uLabelColorScheme', scheme === 'vibrant' ? 1 : scheme === 'muted' ? 2 : scheme === 'sunset' ? 3 : 0);
    };

    const initializeLabelTextureFromPly = (gsplatComponent, resource) => {
        const labelTexture = gsplatComponent.getInstanceTexture('splatLabel');
        if (!labelTexture) return 1;
        const labelData = labelTexture.lock();
        labelData.fill(0);
        let maxLabel = 1;
        const rawLabels = resource?.gsplatData?.getProp?.('label');
        if (rawLabels?.length) {
            const n = Math.min(rawLabels.length, labelData.length);
            for (let i = 0; i < n; i++) {
                const value = Math.max(0, Math.floor(Number(rawLabels[i])));
                maxLabel = Math.max(maxLabel, value);
                labelData[i] = Math.min(255, value);
            }
        }
        labelTexture.unlock();
        return maxLabel;
    };

    const createSelectableSplat = (name, asset, position, rotation, scale) => {
        const entity = new pc.Entity(name);
        const gsplatComponent = entity.addComponent('gsplat', { asset, unified: true });
        entity.setLocalPosition(...position);
        entity.setLocalEulerAngles(...rotation);
        entity.setLocalScale(...scale);
        app.root.addChild(entity);

        const resource = /** @type {pc.GSplatResource} */ (asset.resource);
        const extraStreams = [];
        const ensureStream = (name, format) => {
            if (!resource.format.getStream(name)) {
                extraStreams.push({ name, format, storage: pc.GSPLAT_STREAM_INSTANCE });
            }
        };
        ensureStream('selectionMask', pc.PIXELFORMAT_R8);
        ensureStream('splatLabel', pc.PIXELFORMAT_R8);
        // Per-splat committed edits: similarity transform (rotation + uniform scale +
        // translation) plus an absolute color override.
        ensureStream('editQuat', pc.PIXELFORMAT_RGBA32F);  // (x,y,z,w) rotation, default identity
        ensureStream('editTS', pc.PIXELFORMAT_RGBA32F);    // xyz translate, w uniform scale, default (0,0,0,1)
        ensureStream('editColor', pc.PIXELFORMAT_RGBA8);   // rgb + a = override flag
        ensureStream('hidden', pc.PIXELFORMAT_R8);         // 255 = hidden (e.g. replaced by retexture)
        if (extraStreams.length > 0) resource.format.addExtraStreams(extraStreams);

        // Processor: reads default streams (to get center), writes selectionMask.
        const processor = new pc.GSplatProcessor(
            device,
            { component: gsplatComponent },
            { component: gsplatComponent, streams: ['selectionMask'] },
            selectionShader
        );

        // Zero-initialize the selection mask (0 = not selected).
        const maskTexture = gsplatComponent.getInstanceTexture('selectionMask');
        const maskData = maskTexture.lock();
        maskData.fill(0);
        maskTexture.unlock();

        // Zero-initialize the hidden stream (0 = visible).
        const hiddenTexture = gsplatComponent.getInstanceTexture('hidden');
        const hiddenData = hiddenTexture.lock();
        hiddenData.fill(0);
        hiddenTexture.unlock();

        // Initialize edit streams to identity (no-op) so the modifier is a pass-through
        // until edits are committed.
        const initVec4Stream = (name, x, y, z, w) => {
            const tex = gsplatComponent.getInstanceTexture(name);
            const d = tex.lock();
            for (let i = 0; i < d.length; i += 4) {
                d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = w;
            }
            tex.unlock();
        };
        initVec4Stream('editQuat', 0, 0, 0, 1); // identity rotation
        initVec4Stream('editTS', 0, 0, 0, 1);   // zero translate, unit scale
        const editColorTex = gsplatComponent.getInstanceTexture('editColor');
        const ecd = editColorTex.lock();
        ecd.fill(0);
        editColorTex.unlock();

        gsplatComponent.setWorkBufferModifier(workBufferModifier);
        // Update the work buffer only when something changes (selection, edits,
        // highlight, labels) — each of those paths triggers WORKBUFFER_UPDATE_ONCE.
        // Avoid WORKBUFFER_UPDATE_ALWAYS: it re-renders every splat every frame
        // (doubled in stereo) and was the main XR performance cost.
        gsplatComponent.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;

        // Default active-op uniforms (no preview until the edit system drives them).
        gsplatComponent.setParameter('uHasActiveOp', 0);
        gsplatComponent.setParameter('uActiveQuat', [0, 0, 0, 1]);
        gsplatComponent.setParameter('uActiveTS', [0, 0, 0, 1]);
        gsplatComponent.setParameter('uActivePivot', [0, 0, 0]);
        gsplatComponent.setParameter('uActiveColor', [0, 0, 0, 0]);

        const maxLabel = initializeLabelTextureFromPly(gsplatComponent, resource);
        applyLabelViewerParameters(gsplatComponent, maxLabel);
        applyHighlightParameters(gsplatComponent);

        const numSplats = resource.gsplatData?.numSplats ?? (maskTexture.width * maskTexture.height);
        selectables.push({ entity, gsplatComponent, processor, maxLabel, numSplats, resource });
        return entity;
    };

    // --- Brush selection ----------------------------------------------------
    const pending = [];

    /** Queue a brush selection at a world-space point. mode: SELECT_ADDITIVE|SELECT_SUBTRACTIVE */
    const queueSelect = (worldPoint, radius, mode) => {
        pending.push({ worldPoint: worldPoint.clone(), radius, mode });
    };

    const processPending = () => {
        // Selection scope: when an object is chosen, the brush sphere only marks
        // that object, ignoring splats from others it happens to overlap.
        const target = data.get('activeSelectionTarget') ?? 'all';
        while (pending.length > 0) {
            const { worldPoint, radius, mode } = pending.shift();
            for (const s of selectables) {
                if (!s.entity.enabled) continue;
                if (target !== 'all' && s.entity.name !== target) continue;
                s.processor.setParameter('uBrushSphere', [worldPoint.x, worldPoint.y, worldPoint.z, radius]);
                s.processor.setParameter('uSelMode', mode);
                s.processor.setParameter('uModelMatrix', s.entity.getWorldTransform().data);
                s.processor.blendState = mode === SELECT_ADDITIVE ? additiveBlend : subtractiveBlend;
                s.processor.process();
                s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
            }
        }
    };

    // --- Mask snapshots (undo/redo) -----------------------------------------
    const scopedSelectables = () => {
        const target = data.get('activeSelectionTarget') ?? 'all';
        return selectables.filter(s => s.entity.enabled && (target === 'all' || s.entity.name === target));
    };

    const snapshotMasks = async (objs) => {
        const map = new Map();
        for (const s of objs) {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const buf = await tex.read(0, 0, tex.width, tex.height);
            map.set(s, Uint8Array.from(buf));
        }
        return map;
    };

    const uploadMasks = (map) => {
        for (const [s, bytes] of map) {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const buf = tex.lock(); buf.set(bytes); tex.unlock();
            if (s.entity?.gsplat) s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
        }
    };

    const masksDiffer = (a, b) => {
        for (const [s, bb] of a) {
            const ab = b.get(s);
            if (!ab || ab.length !== bb.length) return true;
            for (let i = 0; i < bb.length; i++) if (ab[i] !== bb[i]) return true;
        }
        return false;
    };

    const pushMaskCommand = (label, before, after) => {
        if (history && before.size) {
            history.push({ label, undo: () => uploadMasks(before), redo: () => uploadMasks(after) });
        }
    };

    // --- Mask operations ----------------------------------------------------
    const clear = async () => {
        const before = history ? await snapshotMasks(selectables) : null;
        for (const s of selectables) {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const buf = tex.lock();
            buf.fill(0);
            tex.unlock();
            s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
        }
        if (before) {
            const after = new Map();
            for (const [s, bytes] of before) after.set(s, new Uint8Array(bytes.length));
            if (masksDiffer(before, after)) pushMaskCommand('limpar seleção', before, after);
        }
    };

    const invert = async () => {
        const before = new Map();
        const after = new Map();
        for (const s of selectables) {
            const tex = s.gsplatComponent.getInstanceTexture('selectionMask');
            if (!tex) continue;
            const current = await tex.read(0, 0, tex.width, tex.height);
            const inv = new Uint8Array(current.length);
            for (let i = 0; i < inv.length; i++) inv[i] = current[i] > 127 ? 0 : 255;
            const buf = tex.lock(); buf.set(inv); tex.unlock();
            s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
            if (history) { before.set(s, Uint8Array.from(current)); after.set(s, inv); }
        }
        pushMaskCommand('inverter seleção', before, after);
    };

    // Hide the currently selected splats (mark the `hidden` stream). Used when a
    // retextured mesh replaces the selected region.
    const hideSelected = async () => {
        for (const s of selectables) {
            const maskTex = s.gsplatComponent.getInstanceTexture('selectionMask');
            const hidTex = s.gsplatComponent.getInstanceTexture('hidden');
            if (!maskTex || !hidTex) continue;
            const mask = await maskTex.read(0, 0, maskTex.width, maskTex.height);
            const buf = hidTex.lock();
            let touched = false;
            for (let i = 0; i < buf.length; i++) if (mask[i] > 127) { buf[i] = 255; touched = true; }
            hidTex.unlock();
            if (touched) s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
        }
    };

    // --- Brush stroke boundaries (undo) -------------------------------------
    // A stroke is one trigger/button press. We snapshot the scoped masks at the
    // start and end, and push a single command for the whole stroke.
    let strokeBefore = null;
    const beginStroke = () => {
        if (!history) return;
        snapshotMasks(scopedSelectables()).then((m) => { strokeBefore = m; });
    };
    const endStroke = () => {
        if (!history || !strokeBefore) return;
        const before = strokeBefore;
        strokeBefore = null;
        snapshotMasks([...before.keys()]).then((after) => {
            if (masksDiffer(before, after)) pushMaskCommand('seleção (pincel)', before, after);
        });
    };

    // --- Parameter sync -----------------------------------------------------
    const updateHighlight = () => {
        for (const s of selectables) applyHighlightParameters(s.gsplatComponent);
        for (const s of selectables) s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
    };

    const syncLabelViewer = () => {
        for (const s of selectables) applyLabelViewerParameters(s.gsplatComponent, s.maxLabel);
        for (const s of selectables) s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
    };

    const destroy = () => {
        for (const s of selectables) s.processor?.destroy();
    };

    return {
        selectables,
        createSelectableSplat,
        registerVisibilityItem,
        syncAssetVisibility,
        queueSelect,
        processPending,
        beginStroke,
        endStroke,
        clear,
        invert,
        hideSelected,
        updateHighlight,
        syncLabelViewer,
        destroy
    };
}
