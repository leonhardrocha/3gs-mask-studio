/**
 * Builds the lightweight HTML control panel and wires it to the observable
 * `data` store with two-way binding. Standalone replacement for the example's
 * React + PCUI controls.
 */

const $body = () => document.getElementById('controls-body');

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
}

function panel(title, ...rows) {
    return el('section', { class: 'group' }, el('h2', { text: title }), ...rows);
}

function row(label, control) {
    return el('label', { class: 'row' }, el('span', { class: 'row-label', text: label }), control);
}

const hexToRgb = hex => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
];
const rgbToHex = ([r, g, b]) => `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

function slider(initial, min, max, step, onInput) {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(initial) });
    const out = el('output', { text: Number(initial).toFixed(2) });
    input.oninput = () => {
        const v = Number(input.value);
        out.textContent = v.toFixed(2);
        onInput(v);
    };
    return el('span', { class: 'slider' }, input, out);
}

// Two-way bound slider: writes to data on input AND updates from data changes
// (so programmatic resets, e.g. after commit, move the slider).
function boundSlider(data, key, min, max, step) {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(data.get(key)) });
    const out = el('output', { text: Number(data.get(key)).toFixed(2) });
    input.oninput = () => data.set(key, Number(input.value));
    data.on(`${key}:set`, (v) => {
        input.value = String(v);
        out.textContent = Number(v).toFixed(2);
    });
    return el('span', { class: 'slider' }, input, out);
}

export function buildControls(data) {
    const body = $body();

    // --- Renderer -----------------------------------------------------------
    const rendererSelect = el('select');
    [[0, 'Auto'], [1, 'Raster (CPU Sort)'], [2, 'Raster (GPU Sort)'], [3, 'Compute']]
        .forEach(([v, t]) => rendererSelect.append(el('option', { value: v, text: t })));
    rendererSelect.onchange = () => data.set('renderer', Number(rendererSelect.value));
    data.on('renderer:set', v => { rendererSelect.value = String(v); });

    // --- XR -----------------------------------------------------------------
    const enterVrBtn = el('button', { type: 'button', text: 'Entrar em VR' });
    enterVrBtn.onclick = () => data.emit('enterVR');
    const rayChk = el('input', { type: 'checkbox' });
    rayChk.checked = data.get('xrRayVisible') !== false;
    rayChk.onchange = () => data.set('xrRayVisible', rayChk.checked);
    const snapChk = el('input', { type: 'checkbox' });
    snapChk.checked = !!data.get('xrSnapToSurface');
    snapChk.onchange = () => data.set('xrSnapToSurface', snapChk.checked);

    // --- Selection ----------------------------------------------------------
    const modeSelect = el('select');
    [['additive', 'Aditiva (+)'], ['subtractive', 'Subtrativa (−)']]
        .forEach(([v, t]) => modeSelect.append(el('option', { value: v, text: t })));
    modeSelect.value = data.get('selectionMode');
    modeSelect.onchange = () => data.set('selectionMode', modeSelect.value);

    const brush = slider(data.get('brushSize'), 0.05, 0.5, 0.01, v => data.set('brushSize', v));

    const clearBtn = el('button', { type: 'button', text: 'Limpar seleção' });
    clearBtn.onclick = () => data.emit('clearSelection');
    const invertBtn = el('button', { type: 'button', text: 'Inverter seleção' });
    invertBtn.onclick = () => data.emit('invertSelection');

    // --- Highlight ----------------------------------------------------------
    const hlColor = el('input', { type: 'color', value: rgbToHex(data.get('selectionColor')) });
    hlColor.oninput = () => data.set('selectionColor', hexToRgb(hlColor.value));
    const hlStrength = slider(data.get('selectionStrength'), 0, 1, 0.01, v => data.set('selectionStrength', v));

    // --- Transform selection ------------------------------------------------
    const editChk = el('input', { type: 'checkbox' });
    editChk.checked = !!data.get('editing');
    editChk.onchange = () => data.set('editing', editChk.checked);
    data.on('editing:set', v => { editChk.checked = !!v; });

    const editColorChk = el('input', { type: 'checkbox' });
    editColorChk.checked = !!data.get('editColorEnabled');
    editColorChk.onchange = () => data.set('editColorEnabled', editColorChk.checked);
    data.on('editColorEnabled:set', v => { editColorChk.checked = !!v; });

    const editColorPick = el('input', { type: 'color', value: rgbToHex(data.get('editColor')) });
    editColorPick.oninput = () => data.set('editColor', hexToRgb(editColorPick.value));
    data.on('editColor:set', v => { editColorPick.value = rgbToHex(v); });

    const applyBtn = el('button', { type: 'button', text: 'Aplicar (commit)' });
    applyBtn.onclick = () => data.emit('commitEdit');
    const resetEditBtn = el('button', { type: 'button', text: 'Resetar op' });
    resetEditBtn.onclick = () => data.emit('resetEdit');
    const pivotBtn = el('button', { type: 'button', text: 'Atualizar pivô' });
    pivotBtn.onclick = () => data.emit('recomputePivot');

    // --- Label viewer -------------------------------------------------------
    const labelEnabled = el('input', { type: 'checkbox' });
    labelEnabled.checked = !!data.get('labelViewerEnabled');
    labelEnabled.onchange = () => data.set('labelViewerEnabled', labelEnabled.checked);
    data.on('labelViewerEnabled:set', v => { labelEnabled.checked = !!v; });

    const labelBlend = slider(data.get('labelBlend'), 0, 1, 0.01, v => data.set('labelBlend', v));

    const mapMode = el('select');
    [['high-contrast', 'Alto Contraste'], ['hsv', 'HSV']]
        .forEach(([v, t]) => mapMode.append(el('option', { value: v, text: t })));
    mapMode.value = data.get('labelColorMapMode');
    mapMode.onchange = () => data.set('labelColorMapMode', mapMode.value);

    const scheme = el('select');
    [['bright', 'Bright'], ['vibrant', 'Vibrant'], ['muted', 'Muted'], ['sunset', 'Sunset']]
        .forEach(([v, t]) => scheme.append(el('option', { value: v, text: t })));
    scheme.value = data.get('labelColorMapScheme');
    scheme.onchange = () => data.set('labelColorMapScheme', scheme.value);

    // --- Asset visibility (dynamic) ----------------------------------------
    const visibilityList = el('div', { class: 'visibility-list' });
    const renderVisibility = () => {
        visibilityList.replaceChildren();
        const items = data.get('assetVisibilityItems') ?? [];
        if (items.length === 0) {
            visibilityList.append(el('p', { class: 'empty', text: 'Nenhum asset carregado' }));
            return;
        }
        for (const item of items) {
            const cb = el('input', { type: 'checkbox' });
            cb.checked = !!data.get(item.path);
            cb.onchange = () => data.set(item.path, cb.checked);
            visibilityList.append(row(item.label, cb));
        }
    };
    data.on('assetVisibilityItems:set', renderVisibility);
    renderVisibility();

    // --- Export -------------------------------------------------------------
    const exportScope = el('select');
    [['subset', 'Apenas a seleção'], ['whole', 'Nuvem inteira']]
        .forEach(([v, t]) => exportScope.append(el('option', { value: v, text: t })));
    const exportBtn = el('button', { type: 'button', text: 'Exportar .ply' });
    exportBtn.onclick = () => data.emit('exportPly', exportScope.value);

    // --- Dynamic asset loading ---------------------------------------------
    const urlInput = el('input', { type: 'text', placeholder: 'nome-do-arquivo.ply' });
    const addBtn = el('button', { type: 'button', text: 'Adicionar' });
    addBtn.onclick = () => data.emit('addAsset', urlInput.value);

    // --- Assemble -----------------------------------------------------------
    body.replaceChildren(
        panel('Renderer', row('Renderer', rendererSelect)),
        panel('XR',
            row('Raio visível', rayChk),
            row('Distância do raio', boundSlider(data, 'xrRayDistance', 0.2, 8, 0.05)),
            row('Velocidade mov.', boundSlider(data, 'xrMoveSpeed', 0.3, 5, 0.1)),
            row('Snap superfície (exp.)', snapChk),
            enterVrBtn
        ),
        panel('Seleção',
            row('Modo', modeSelect),
            row('Tamanho do pincel', brush),
            clearBtn,
            invertBtn
        ),
        panel('Realce',
            row('Cor', hlColor),
            row('Força', hlStrength)
        ),
        panel('Transformar seleção',
            row('Editar (preview)', editChk),
            row('Mover X', boundSlider(data, 'editTx', -2, 2, 0.01)),
            row('Mover Y', boundSlider(data, 'editTy', -2, 2, 0.01)),
            row('Mover Z', boundSlider(data, 'editTz', -2, 2, 0.01)),
            row('Rotação X', boundSlider(data, 'editRx', -180, 180, 1)),
            row('Rotação Y', boundSlider(data, 'editRy', -180, 180, 1)),
            row('Rotação Z', boundSlider(data, 'editRz', -180, 180, 1)),
            row('Escala', boundSlider(data, 'editScale', 0.1, 3, 0.01)),
            row('Recolorir', editColorChk),
            row('Cor', editColorPick),
            pivotBtn,
            applyBtn,
            resetEditBtn
        ),
        panel('Visualizador de Labels',
            row('Ativado', labelEnabled),
            row('Mistura', labelBlend),
            row('Mapa de cores', mapMode),
            row('Esquema Paul Tol', scheme)
        ),
        panel('Exportar',
            row('Escopo', exportScope),
            exportBtn
        ),
        panel('Visibilidade dos Assets', visibilityList),
        panel('Carregar Asset', el('div', { class: 'add-asset' }, urlInput, addBtn))
    );
}
