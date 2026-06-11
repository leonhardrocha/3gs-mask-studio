import * as pc from 'playcanvas';
import { MotionController, fetchProfile, Constants } from '@webxr-input-profiles/motion-controllers';

/**
 * High-fidelity XR controller models via WebXR Input Profiles (Fase 2) + per-button
 * action hint icons (Fase 3 follow-up).
 *
 * For each input source we resolve its WebXR profile (`fetchProfile`) against the
 * LOCALLY VENDORED profiles in `public/static/webxr-input-profiles/profiles`
 * (no CDN — works offline / over LAN on the headset), load the matching glTF and
 * parent it to the controller entity (grip space). Each frame, `updateFromGamepad`
 * drives the per-component `visualResponses`, animating buttons / trigger / grip /
 * thumbstick by interpolating named nodes — real button feedback.
 *
 * Small icon billboards float over the relevant buttons so each button's action is
 * legible when you look at the controller:
 *   - grid  → open the mode panel (A). A grid (not ☰) to avoid clashing with the
 *             headset's own system-menu glyph on the left controller.
 *   - dot   → select / confirm (trigger).
 *   - − / + → shrink / grow the brush (left X / Y).
 * Icons are drawn with canvas PATHS (not Unicode glyphs, which may be missing from
 * the headset browser font), and pinned in the controller's own space (predictable
 * scale) at each button node's position, billboarded to the camera.
 *
 * If the profile or model is unavailable the controller keeps its placeholder box;
 * nothing throws (and the reason is logged). Meshes need scene lighting to be
 * visible (added in main) — splats are self-lit, but glTF/box materials are black
 * without a light.
 */

const DEFAULT_PROFILE = 'generic-trigger-squeeze-thumbstick';
const HINT_OFFSET = 0.02; // m floated toward the camera
const HINT_SIZE = 0.028;  // m

// component id -> hint icon kind, per handedness (matches the xr-session remap)
const HINTS = {
    left: { 'x-button': 'minus', 'y-button': 'plus' },
    right: { 'a-button': 'menu', 'xr-standard-trigger': 'select' }
};

const loadGlb = (app, url) => new Promise((resolve) => {
    const asset = new pc.Asset(`xr-ctrl:${url}`, 'container', { url });
    asset.once('load', () => {
        try { resolve(asset.resource.instantiateRenderEntity()); }
        catch (e) { console.warn('[controller-models] instantiate falhou:', e); resolve(null); }
    });
    asset.once('error', (err) => { console.warn('[controller-models] glb load falhou:', url, err); resolve(null); });
    app.assets.add(asset);
    app.assets.load(asset);
});

function drawIcon(x, kind) {
    x.clearRect(0, 0, 96, 96);
    x.beginPath(); x.arc(48, 48, 44, 0, Math.PI * 2);
    x.fillStyle = 'rgba(16,22,32,0.9)'; x.fill();
    x.lineWidth = 5; x.strokeStyle = 'rgba(120,210,255,0.95)'; x.stroke();

    x.strokeStyle = '#eaf6ff'; x.fillStyle = '#eaf6ff'; x.lineCap = 'round'; x.lineWidth = 9;
    const bar = (x0, y0, x1, y1) => { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
    if (kind === 'minus') { bar(28, 48, 68, 48); }
    else if (kind === 'plus') { bar(28, 48, 68, 48); bar(48, 28, 48, 68); }
    else if (kind === 'select') {
        x.beginPath(); x.arc(48, 48, 13, 0, Math.PI * 2); x.fill();
        x.lineWidth = 5; x.beginPath(); x.arc(48, 48, 24, 0, Math.PI * 2); x.stroke();
    } else if (kind === 'menu') { // 2×2 grid = "modes panel"
        const s = 13, g = 7, ox = 29, oy = 29;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) x.fillRect(ox + c * (s + g), oy + r * (s + g), s, s);
    }
}

export function createControllerModels({ app, camera, rootPath, uiLayer }) {
    const basePath = `${rootPath}/static/webxr-input-profiles/profiles`;
    const byInputSource = new Map(); // pc input source -> { motionController, root, nodes, hints }
    const tmpV = new pc.Vec3();
    const tmpQ = new pc.Quat();
    const camPos = new pc.Vec3();
    const nodePos = new pc.Vec3();
    const dir = new pc.Vec3();

    const makeHint = (kind) => {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        drawIcon(c.getContext('2d'), kind);
        const tex = new pc.Texture(app.graphicsDevice, {
            width: 96, height: 96, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
            minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE
        });
        tex.setSource(c);

        const mat = new pc.StandardMaterial();
        mat.diffuse = new pc.Color(0, 0, 0);
        mat.emissive = new pc.Color(1, 1, 1);
        mat.emissiveMap = tex; mat.opacityMap = tex; mat.opacityMapChannel = 'a';
        mat.blendType = pc.BLEND_NORMAL;
        mat.depthTest = false; mat.depthWrite = false; // draw over the controller mesh
        mat.cull = pc.CULLFACE_NONE; mat.update();

        const holder = new pc.Entity('hint');
        const quad = new pc.Entity('hint-quad');
        quad.addComponent('render', { type: 'plane' });
        quad.render.material = mat;
        if (uiLayer) quad.render.layers = [uiLayer.id];
        quad.setLocalEulerAngles(-90, 0, 0); // plane normal → holder -Z (billboarded)
        quad.setLocalScale(HINT_SIZE, 1, HINT_SIZE);
        holder.addChild(quad);
        holder._mat = mat; holder._tex = tex;
        return holder;
    };

    const resolveNodes = (root, motionController) => {
        const list = [];
        for (const component of Object.values(motionController.components)) {
            for (const vr of Object.values(component.visualResponses)) {
                const valueNode = root.findByName(vr.valueNodeName);
                if (!valueNode) continue;
                if (vr.valueNodeProperty === Constants.VisualResponseProperty.TRANSFORM) {
                    const minNode = root.findByName(vr.minNodeName);
                    const maxNode = root.findByName(vr.maxNodeName);
                    if (!minNode || !maxNode) continue;
                    list.push({ vr, valueNode, minNode, maxNode, transform: true });
                } else {
                    list.push({ vr, valueNode, transform: false });
                }
            }
        }
        return list;
    };

    // Find a button node: its component rootNode, else the first visual-response node.
    const buttonNode = (root, comp) => {
        return (comp.rootNodeName && root.findByName(comp.rootNodeName)) ||
            root.findByName(Object.values(comp.visualResponses)[0]?.valueNodeName) || null;
    };

    // Hints live in the controller entity's space (predictable scale); each frame
    // they're moved to the button node's world position and billboarded.
    const attachHints = (entity, root, motionController, handedness) => {
        const map = HINTS[handedness] || {};
        const hints = [];
        for (const [compId, kind] of Object.entries(map)) {
            const comp = motionController.components[compId];
            if (!comp) continue;
            const node = buttonNode(root, comp);
            if (!node) continue;
            const holder = makeHint(kind);
            entity.addChild(holder);
            hints.push({ holder, node });
        }
        return hints;
    };

    const attach = async (pcInputSource, entity) => {
        const xrInputSource = pcInputSource.inputSource; // raw XRInputSource
        if (!xrInputSource) return;
        try {
            const { profile, assetPath } = await fetchProfile(xrInputSource, basePath, DEFAULT_PROFILE);
            const motionController = new MotionController(xrInputSource, profile, assetPath);
            const root = await loadGlb(app, motionController.assetUrl);
            if (!root) return; // keep fallback box
            if (!entity || !entity.parent) { root.destroy(); return; } // removed while loading
            entity.addChild(root);
            const nodes = resolveNodes(root, motionController);
            const hints = attachHints(entity, root, motionController, xrInputSource.handedness);
            byInputSource.set(pcInputSource, { motionController, root, nodes, hints });
            if (entity.fallbackBox) entity.fallbackBox.enabled = false;
            console.log(`[controller-models] modelo anexado: ${profile.profileId} (${xrInputSource.handedness}), ${nodes.length} nós, ${hints.length} ícones`);
        } catch (err) {
            console.warn('[controller-models] perfil/modelo indisponível, mantendo fallback:', err?.message ?? err);
        }
    };

    const update = () => {
        if (camera) camPos.copy(camera.getPosition());
        for (const { motionController, nodes, hints } of byInputSource.values()) {
            motionController.updateFromGamepad();
            for (const n of nodes) {
                const value = n.vr.value;
                if (!n.transform) { n.valueNode.enabled = value >= 0.5; continue; }
                tmpV.lerp(n.minNode.getLocalPosition(), n.maxNode.getLocalPosition(), value);
                n.valueNode.setLocalPosition(tmpV);
                tmpQ.slerp(n.minNode.getLocalRotation(), n.maxNode.getLocalRotation(), value);
                n.valueNode.setLocalRotation(tmpQ);
            }
            if (!camera) continue;
            for (const h of hints) {
                nodePos.copy(h.node.getPosition());
                dir.copy(camPos).sub(nodePos);
                if (dir.lengthSq() > 1e-8) dir.normalize();
                h.holder.setPosition(nodePos.x + dir.x * HINT_OFFSET, nodePos.y + dir.y * HINT_OFFSET, nodePos.z + dir.z * HINT_OFFSET);
                h.holder.lookAt(camPos); // billboard the icon
            }
        }
    };

    const disposeModel = (m) => {
        if (!m) return;
        for (const h of m.hints || []) { h.holder._tex?.destroy(); h.holder._mat?.destroy(); h.holder.destroy(); }
        m.root.destroy();
    };

    const remove = (pcInputSource) => {
        const m = byInputSource.get(pcInputSource);
        if (m) { disposeModel(m); byInputSource.delete(pcInputSource); }
    };

    const destroy = () => {
        for (const m of byInputSource.values()) disposeModel(m);
        byInputSource.clear();
    };

    return { attach, update, remove, destroy };
}
