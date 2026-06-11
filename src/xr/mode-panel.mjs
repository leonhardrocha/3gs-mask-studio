import * as pc from 'playcanvas';

/**
 * Virtual mode panel (Fase 3) — a world-space menu that lazy-follows the head and
 * is driven by the joystick. Replaces the per-button control overload with a few
 * MODES (Seleção / Edição / Exportar); locomotion stays available except while the
 * panel is open. "Visualização" (labels) and undo/redo are global items shown in
 * every mode.
 *
 * Rendering: a 2D canvas is drawn (mode header + option rows + focus highlight) and
 * uploaded to a texture mapped on a quad. Navigation:
 *   - vertical   → move focus across rows (row 0 = mode header).
 *   - horizontal → on the header: switch mode; on an adjustable row: change value.
 *   - activate   → run the focused row's action.
 *
 * The panel is engine-rendered, so it works on desktop too (lazy-follows the
 * camera), which is handy for testing without a headset.
 *
 * NOTE: if the panel text appears mirrored or upside-down in the headset, flip the
 * quad orientation (`QUAD_EULER_X`) or the canvas — orientation can't be verified
 * here without an HMD.
 */

const W = 512, H = 640;
const PANEL_W_M = 0.42;                 // world width (m)
const PANEL_H_M = PANEL_W_M * H / W;    // keep aspect
const QUAD_EULER_X = -90;               // plane(+Y normal) → face the panel's -Z (toward camera)
const FOLLOW_DIST = 0.7;                // m in front of the head
const FOLLOW_TAU = 0.12;                // s lazy-follow time constant

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cycle = (arr, cur, dir) => arr[(arr.indexOf(cur) + dir + arr.length) % arr.length];

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export function createModePanel({ app, camera, data, uiLayer }) {
    // --- Mode / option model (declarative; reads & drives `data`) ------------
    let editOp = 'move';   // move | rotate | scale
    let editAxis = 'x';    // x | y | z
    const ops = ['move', 'rotate', 'scale'];
    const axes = ['x', 'y', 'z'];
    const opLabel = { move: 'Mover', rotate: 'Rotacionar', scale: 'Escalar' };

    // Continuous edit nudge: `d` is signed stick·seconds; each op scales its rate.
    const nudgeEditCont = (d) => {
        if (editOp === 'move') {
            const k = { x: 'editTx', y: 'editTy', z: 'editTz' }[editAxis];
            data.set(k, +(((data.get(k) || 0) + d * 0.6).toFixed(3)));
        } else if (editOp === 'rotate') {
            const k = { x: 'editRx', y: 'editRy', z: 'editRz' }[editAxis];
            data.set(k, +(((data.get(k) || 0) + d * 60).toFixed(1)));
        } else {
            data.set('editScale', Math.max(0.05, +(((data.get('editScale') || 1) + d * 0.6).toFixed(3))));
        }
    };
    const editVal = () => {
        if (editOp === 'move') return (data.get({ x: 'editTx', y: 'editTy', z: 'editTz' }[editAxis]) || 0).toFixed(2);
        if (editOp === 'rotate') return (data.get({ x: 'editRx', y: 'editRy', z: 'editRz' }[editAxis]) || 0).toFixed(0) + '°';
        return (data.get('editScale') || 1).toFixed(2);
    };

    const targetList = () => ['all', ...((data.get('assetVisibilityItems') || []).map(i => i.name))];
    const targetLabel = () => {
        const t = data.get('activeSelectionTarget') || 'all';
        if (t === 'all') return 'Todos';
        return (data.get('assetVisibilityItems') || []).find(i => i.name === t)?.label || t;
    };
    const cycleTarget = (dir) => {
        const list = targetList();
        const cur = data.get('activeSelectionTarget') || 'all';
        data.set('activeSelectionTarget', cycle(list, list.includes(cur) ? cur : 'all', dir));
    };

    const MODES = [
        { id: 'select', name: 'Seleção', items: () => [
            { label: `Modo: ${data.get('selectionMode') === 'additive' ? 'Aditivo (+)' : 'Subtrativo (−)'}`,
                activate: () => data.set('selectionMode', data.get('selectionMode') === 'additive' ? 'subtractive' : 'additive') },
            { label: `Pincel: ${(data.get('brushSize') ?? 0.15).toFixed(2)}`,
                cont: (d) => data.set('brushSize', +clamp((data.get('brushSize') ?? 0.15) + d * 0.4, 0.02, 1).toFixed(3)) },
            { label: `Objeto: ${targetLabel()}`, adjust: cycleTarget },
            { label: 'Limpar seleção', activate: () => data.emit('clearSelection') },
            { label: 'Inverter seleção', activate: () => data.emit('invertSelection') }
        ] },
        { id: 'edit', name: 'Edição', items: () => [
            { label: `Preview: ${data.get('editing') ? 'ON' : 'off'}`, activate: () => data.set('editing', !data.get('editing')) },
            { label: `Op: ${opLabel[editOp]}`, adjust: (d) => { editOp = cycle(ops, editOp, d); } },
            { label: `Eixo: ${editAxis.toUpperCase()}`, adjust: (d) => { editAxis = cycle(axes, editAxis, d); } },
            { label: `Ajustar ${opLabel[editOp]}${editOp === 'scale' ? '' : ' ' + editAxis.toUpperCase()}: ${editVal()}`, cont: nudgeEditCont },
            { label: `Recolorir: ${data.get('editColorEnabled') ? 'ON' : 'off'}`, activate: () => data.set('editColorEnabled', !data.get('editColorEnabled')) },
            { label: 'Aplicar (commit)', activate: () => data.emit('commitEdit') },
            { label: 'Resetar op', activate: () => data.emit('resetEdit') }
        ] },
        { id: 'export', name: 'Exportar', items: () => [
            { label: 'Exportar seleção (.ply)', activate: () => data.emit('exportPly', 'subset') },
            { label: 'Exportar tudo (.ply)', activate: () => data.emit('exportPly', 'whole') }
        ] },
        { id: 'retexture', name: 'Retexturizar', items: () => [
            { label: `Objeto: ${data.get('retextureRunName') || 'Fruits'}`,
                adjust: (d) => {
                    const list = data.get('retexObjects') || ['Fruits'];
                    const cur = data.get('retextureRunName') || list[0];
                    data.set('retextureRunName', cycle(list, list.includes(cur) ? cur : list[0], d));
                } },
            { label: 'Adicionar objeto', activate: () => data.emit('addRetexObject') },
            { label: `Textura: ${data.get('retextureTextureName') || '—'}` },
            { label: 'Aplicar retexturização', activate: () => data.emit('applyRetexture') },
            { label: `Status: ${data.get('retextureStatus') || 'pronto'}` }
        ] }
    ];
    const globalItems = () => [
        { label: 'Desfazer (undo)', activate: () => data.emit('undo') },
        { label: 'Refazer (redo)', activate: () => data.emit('redo') },
        { label: `Labels: ${data.get('labelViewerEnabled') ? 'ON' : 'off'}`, activate: () => data.set('labelViewerEnabled', !data.get('labelViewerEnabled')) }
    ];

    let modeIdx = 0;
    let focus = 1; // 0 = mode header, 1.. = rows
    const rows = () => [...MODES[modeIdx].items(), ...globalItems()];

    // --- Canvas / texture / entity ------------------------------------------
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const texture = new pc.Texture(app.graphicsDevice, {
        width: W, height: H, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
        minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE
    });

    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = new pc.Color(1, 1, 1);
    material.emissiveMap = texture;
    material.opacityMap = texture;
    material.opacityMapChannel = 'a';
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    material.update();

    const root = new pc.Entity('mode-panel');
    const quad = new pc.Entity('mode-panel-quad');
    quad.addComponent('render', { type: 'plane' });
    quad.render.material = material;
    if (uiLayer) quad.render.layers = [uiLayer.id];
    quad.setLocalEulerAngles(QUAD_EULER_X, 0, 0);
    quad.setLocalScale(PANEL_W_M, 1, PANEL_H_M);
    root.addChild(quad);
    root.enabled = false;
    app.root.addChild(root);

    const redraw = () => {
        const items = rows();
        const mode = MODES[modeIdx];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        // The quad maps the canvas rotated 180° (engine doesn't flipY canvas
        // textures + plane UV orientation). Pre-rotate the drawing 180° to cancel
        // it, so the panel reads upright and un-mirrored on the headset.
        ctx.translate(W, H);
        ctx.scale(-1, -1);

        roundRect(ctx, 8, 8, W - 16, H - 16, 24);
        ctx.fillStyle = 'rgba(14,18,26,0.92)'; ctx.fill();
        ctx.strokeStyle = 'rgba(90,200,255,0.5)'; ctx.lineWidth = 3; ctx.stroke();

        // Header (mode switch row).
        if (focus === 0) { ctx.fillStyle = 'rgba(90,200,255,0.20)'; roundRect(ctx, 24, 22, W - 48, 74, 14); ctx.fill(); }
        ctx.fillStyle = '#dff'; ctx.font = 'bold 36px sans-serif';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(`◀  ${mode.name}  ▶`, W / 2, 56);
        ctx.font = '13px sans-serif'; ctx.fillStyle = 'rgba(180,220,255,0.55)';
        ctx.fillText('modo', W / 2, 84);

        // Option rows.
        ctx.textAlign = 'left';
        const rowH = 40;
        let y = 112;
        for (let i = 0; i < items.length; i++) {
            const f = focus === i + 1;
            if (f) { ctx.fillStyle = 'rgba(90,200,255,0.22)'; roundRect(ctx, 22, y, W - 44, rowH - 6, 10); ctx.fill(); }
            ctx.fillStyle = f ? '#ffffff' : '#aac4dd';
            ctx.font = (f ? 'bold ' : '') + '21px sans-serif';
            ctx.fillText((f ? '▶ ' : '   ') + items[i].label, 38, y + (rowH - 6) / 2 + 1);
            if (f && items[i].adjust) { ctx.textAlign = 'right'; ctx.fillText('◀ ▶', W - 40, y + (rowH - 6) / 2 + 1); ctx.textAlign = 'left'; }
            y += rowH;
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(160,200,240,0.5)'; ctx.font = '13px sans-serif';
        ctx.fillText('stick: navegar / ajustar  ·  gatilho: confirmar  ·  A: fechar', W / 2, H - 24);

        texture.setSource(canvas);
    };

    // --- Navigation ----------------------------------------------------------
    let dirty = true;
    const markDirty = () => { dirty = true; };

    const navVertical = (dir) => { const n = rows().length + 1; focus = (focus + dir + n) % n; markDirty(); };
    // Discrete horizontal: mode switch (header) or cycle rows (`adjust`); a
    // continuous row gets a small fixed bump (keyboard/desktop path).
    const navHorizontal = (dir) => {
        if (focus === 0) modeIdx = (modeIdx + dir + MODES.length) % MODES.length;
        else { const r = rows()[focus - 1]; if (r?.cont) r.cont(dir * 0.05); else r?.adjust?.(dir); }
        markDirty();
    };
    // Continuous horizontal (analog stick): only for `cont` rows. Returns whether handled.
    const adjustContinuous = (amount) => {
        if (focus === 0) return false;
        const r = rows()[focus - 1];
        if (r?.cont) { r.cont(amount); markDirty(); return true; }
        return false;
    };
    const focusedIsContinuous = () => focus !== 0 && !!rows()[focus - 1]?.cont;
    const activate = () => {
        if (focus === 0) return;
        const it = rows()[focus - 1];
        if (it?.activate) it.activate();
        else if (it?.adjust) it.adjust(1);
        markDirty();
    };

    let open = false;
    let snapFollow = false;
    const setOpen = (v) => {
        if (open === v) return;
        open = v;
        root.enabled = v;
        if (v) { snapFollow = true; markDirty(); }
    };

    // --- Lazy-follow + redraw -----------------------------------------------
    const camPos = new pc.Vec3();
    const fwd = new pc.Vec3();
    const target = new pc.Vec3();
    const cur = new pc.Vec3();
    let lastDraw = 0;

    const updateFollow = (dt) => {
        if (!open) return;
        try {
            camPos.copy(camera.getPosition());
            fwd.set(0, 0, -1);
            camera.getRotation().transformVector(fwd, fwd);
            target.copy(camPos).add(fwd.mulScalar(FOLLOW_DIST));
            if (snapFollow) { cur.copy(target); snapFollow = false; }
            else { const a = 1 - Math.exp(-dt / FOLLOW_TAU); cur.lerp(cur, target, a); }
            root.setPosition(cur);
            root.lookAt(camPos); // -Z toward the head, kept upright via default world-up

            // Redraw on change, plus a low-rate refresh for external data changes.
            const now = performance.now();
            if (dirty || now - lastDraw > 200) { redraw(); dirty = false; lastDraw = now; }
        } catch (err) {
            console.error('[mode-panel] erro no updateFollow (painel ocultado):', err);
            setOpen(false);
        }
    };

    const destroy = () => { root.destroy(); texture.destroy(); material.destroy(); };

    return {
        updateFollow, navVertical, navHorizontal, adjustContinuous, focusedIsContinuous, activate, destroy,
        open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!open),
        get isOpen() { return open; },
        get currentModeId() { return MODES[modeIdx].id; }
    };
}
