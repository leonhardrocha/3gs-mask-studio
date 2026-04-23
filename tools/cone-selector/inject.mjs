/**
 * inject.mjs — Seleção por cone injetável no SuperSplat
 *
 * Como usar:
 *   1. Abra o SuperSplat em http://localhost:3000
 *   2. Carregue um arquivo .ply (drag-drop ou ?load=<url>)
 *   3. No console do DevTools, execute:
 *        const s = document.createElement('script');
 *        s.type = 'module';
 *        s.src = 'http://localhost:8080/tools/cone-selector/inject.mjs';
 *        document.head.appendChild(s);
 *   4. O painel de seleção por cone aparece no canto superior direito.
 *
 * Integração com window.scene:
 *   - Acessa window.scene.elements para obter os splats carregados.
 *   - Aplica o predicado de cone exato nos arrays x/y/z/state do splatData.
 *   - Chama splat.updateState() para atualizar o highlight na UI do SuperSplat.
 *   - O botão "Enviar ao Bridge" serializa as gaussianas selecionadas em PLY
 *     binário e envia via POST /process-mask.
 */

// ---------------------------------------------------------------------------
// Configuração padrão do bridge
// ---------------------------------------------------------------------------
const BRIDGE_URL = 'http://localhost:3001/process-mask';

// ---------------------------------------------------------------------------
// Predicado de cone — mesma função de select-cone.mjs e vr-masker.mjs
// ---------------------------------------------------------------------------
function pointInsideCone(px, py, pz, apex, axis, tanAngle, maxRange) {
    const dx = px - apex[0];
    const dy = py - apex[1];
    const dz = pz - apex[2];
    const t = dx * axis[0] + dy * axis[1] + dz * axis[2];
    if (t < 0 || t > maxRange) return false;
    const rx = dx - t * axis[0];
    const ry = dy - t * axis[1];
    const rz = dz - t * axis[2];
    const limit = t * tanAngle;
    return (rx * rx + ry * ry + rz * rz) <= limit * limit;
}

// ---------------------------------------------------------------------------
// Aplicar seleção por cone no primeiro splat carregado no SuperSplat
// ---------------------------------------------------------------------------
function applyConeSeleciton(apex, axis, angleDeg, range, op) {
    const scene = window.scene;
    if (!scene) return { error: 'window.scene não encontrado. SuperSplat carregado?' };

    // Filtrar elementos do tipo splat (ElementType.splat === 'splat')
    const splats = scene.elements.filter(e => e.constructor?.name === 'Splat' || e.splatData);
    if (splats.length === 0) return { error: 'Nenhum splat carregado no SuperSplat.' };

    const splat = splats[0];
    const { splatData } = splat;
    if (!splatData) return { error: 'splatData não disponível.' };

    const x = splatData.getProp('x');
    const y = splatData.getProp('y');
    const z = splatData.getProp('z');
    const stateArr = splatData.getProp('state');

    if (!x || !y || !z) return { error: 'Propriedades x/y/z não encontradas no splatData.' };

    const tanA = Math.tan(angleDeg * Math.PI / 180);
    const n = splatData.numSplats;

    // Normalizar axis
    const len = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
    const normAxis = len > 0 ? axis.map(v => v / len) : [0, 0, -1];

    let count = 0;
    for (let i = 0; i < n; i++) {
        const inside = pointInsideCone(x[i], y[i], z[i], apex, normAxis, tanA, range);
        if (stateArr) {
            const deleted = (stateArr[i] & 2) !== 0;
            const locked  = (stateArr[i] & 4) !== 0;
            if (!deleted && !locked) {
                if (op === 'set') {
                    stateArr[i] = inside ? 1 : 0;
                } else if (op === 'add' && inside) {
                    stateArr[i] |= 1;
                } else if (op === 'remove' && inside) {
                    stateArr[i] &= ~1;
                }
            }
        }
        if (inside) count++;
    }

    // Atualizar a textura de estado no SuperSplat
    try {
        // Tenta via método público updateState (presente em versões recentes)
        if (typeof splat.updateState === 'function') {
            splat.updateState();
        } else if (splat.stateTexture) {
            // Fallback: upload manual da textura
            const tex = splat.stateTexture;
            const data = tex.lock();
            data.set(stateArr);
            tex.unlock();
        }
    } catch (e) {
        return { error: `Erro ao atualizar state: ${e.message}` };
    }

    // Forçar re-render
    scene.forceRender = true;

    return { ok: true, total: n, inside: count };
}

// ---------------------------------------------------------------------------
// Serialização PLY binário das gaussianas selecionadas
// ---------------------------------------------------------------------------
function serializeSelectedPly(apex, axis, angleDeg, range) {
    const scene = window.scene;
    const splats = scene?.elements?.filter(e => e.splatData) ?? [];
    if (!splats.length) return null;

    const splat = splats[0];
    const { splatData } = splat;
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2',
                   'scale_0', 'scale_1', 'scale_2',
                   'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity'];
    const available = props.filter(p => splatData.getProp(p) != null);
    const arrays = available.map(p => splatData.getProp(p));

    const stateArr = splatData.getProp('state');
    const n = splatData.numSplats;

    // Coletar índices selecionados (state bit 0)
    const selected = [];
    for (let i = 0; i < n; i++) {
        if (!stateArr || (stateArr[i] & 1) !== 0) selected.push(i);
    }
    if (!selected.length) return null;

    // Construir cabeçalho PLY
    const propLines = available.map(p => `property float ${p}`).join('\n');
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${selected.length}`,
        propLines,
        'end_header',
        ''
    ].join('\n');

    const headerBytes = new TextEncoder().encode(header);
    const stride = available.length * 4; // float32
    const body = new Uint8Array(selected.length * stride);
    const view = new DataView(body.buffer);

    for (let si = 0; si < selected.length; si++) {
        const i = selected[si];
        for (let j = 0; j < arrays.length; j++) {
            view.setFloat32((si * available.length + j) * 4, arrays[j][i], true);
        }
    }

    const blob = new Uint8Array(headerBytes.length + body.length);
    blob.set(headerBytes, 0);
    blob.set(body, headerBytes.length);
    return { buffer: blob.buffer, count: selected.length };
}

// ---------------------------------------------------------------------------
// Enviar PLY ao bridge
// ---------------------------------------------------------------------------
async function sendToBridge(statusEl, apex, axis, angleDeg, range) {
    statusEl.textContent = 'Serializando...';
    const result = serializeSelectedPly(apex, axis, angleDeg, range);
    if (!result) {
        statusEl.textContent = 'Erro: nenhuma gaussiana selecionada.';
        return;
    }
    statusEl.textContent = `Enviando ${result.count} gaussianas...`;
    try {
        const form = new FormData();
        form.append('file', new Blob([result.buffer], { type: 'application/octet-stream' }), 'selected.ply');
        const resp = await fetch(BRIDGE_URL, { method: 'POST', body: form });
        const json = await resp.json();
        if (json.ok) {
            statusEl.textContent = `Bridge OK — ${json.outputBytes} bytes`;
        } else {
            statusEl.textContent = `Bridge erro: ${json.error ?? JSON.stringify(json)}`;
        }
    } catch (e) {
        statusEl.textContent = `Fetch error: ${e.message}`;
    }
}

// ---------------------------------------------------------------------------
// Obter bounding box do primeiro splat para sugerir apex padrão
// ---------------------------------------------------------------------------
function getDefaultApex() {
    const splats = window.scene?.elements?.filter(e => e.splatData) ?? [];
    if (!splats.length) return [0, 0, 3];
    try {
        const bound = splats[0].worldBound ?? splats[0].localBoundStorage;
        if (bound) {
            const { center } = bound;
            return [
                parseFloat((center.x).toFixed(3)),
                parseFloat((center.y + bound.halfExtents.y).toFixed(3)),
                parseFloat((center.z + bound.halfExtents.z * 0.5).toFixed(3))
            ];
        }
    } catch (_) {}
    return [0, 0, 3];
}

// ---------------------------------------------------------------------------
// Injetar painel na DOM
// ---------------------------------------------------------------------------
function injectPanel() {
    if (document.getElementById('cone-selector-panel')) {
        console.log('[cone-selector] painel já injetado');
        return;
    }

    const defaultApex = getDefaultApex();

    const panel = document.createElement('div');
    panel.id = 'cone-selector-panel';
    panel.style.cssText = `
        position: fixed; top: 60px; right: 12px; z-index: 9999;
        background: rgba(20,20,30,0.92); color: #e0e0e0;
        font-family: monospace; font-size: 12px;
        border: 1px solid rgba(100,180,255,0.4); border-radius: 8px;
        padding: 12px 14px; width: 230px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.6);
        user-select: none;
    `;

    panel.innerHTML = `
        <div style="font-weight:bold;margin-bottom:8px;color:#7dd3fc;">
            🔵 Cone Selector
            <span id="cone-close" style="float:right;cursor:pointer;opacity:0.6;">✕</span>
        </div>
        <label>Ápice (x y z)</label><br>
        <input id="cs-apex" type="text" value="${defaultApex.join(' ')}"
            style="width:100%;background:#0a0a18;color:#e0e0e0;border:1px solid #334;
                   border-radius:3px;padding:3px 5px;margin:3px 0 6px;font-size:11px;">
        <label>Eixo (x y z)</label><br>
        <input id="cs-axis" type="text" value="0 0 -1"
            style="width:100%;background:#0a0a18;color:#e0e0e0;border:1px solid #334;
                   border-radius:3px;padding:3px 5px;margin:3px 0 6px;font-size:11px;">
        <label>Ângulo (°): <span id="cs-angle-val">30</span></label><br>
        <input id="cs-angle" type="range" min="1" max="90" value="30"
            style="width:100%;margin:3px 0 6px;">
        <label>Range (m): <span id="cs-range-val">5</span></label><br>
        <input id="cs-range" type="range" min="0.1" max="20" step="0.1" value="5"
            style="width:100%;margin:3px 0 8px;">
        <label>Operação:</label><br>
        <select id="cs-op" style="width:100%;background:#0a0a18;color:#e0e0e0;
            border:1px solid #334;border-radius:3px;padding:3px 5px;margin:3px 0 8px;">
            <option value="add">Add</option>
            <option value="set">Set</option>
            <option value="remove">Remove</option>
        </select>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button id="cs-select" style="flex:1;padding:5px;background:#1d4ed8;
                color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                Selecionar
            </button>
            <button id="cs-clear" style="flex:0 0 auto;padding:5px 8px;background:#374151;
                color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                Limpar
            </button>
        </div>
        <button id="cs-send" style="width:100%;padding:5px;background:#059669;
            color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;
            margin-bottom:6px;">
            Enviar ao Bridge
        </button>
        <div id="cs-status" style="font-size:10px;color:#94a3b8;min-height:16px;word-break:break-all;"></div>
    `;

    document.body.appendChild(panel);

    // Fechar
    document.getElementById('cone-close').addEventListener('click', () => panel.remove());

    // Sliders → label
    const angleInput = document.getElementById('cs-angle');
    const angleVal   = document.getElementById('cs-angle-val');
    const rangeInput = document.getElementById('cs-range');
    const rangeVal   = document.getElementById('cs-range-val');
    angleInput.addEventListener('input', () => { angleVal.textContent = angleInput.value; });
    rangeInput.addEventListener('input', () => { rangeVal.textContent = rangeInput.value; });

    const statusEl = document.getElementById('cs-status');

    const getParams = () => {
        const apex = document.getElementById('cs-apex').value.trim().split(/\s+/).map(Number);
        const axis = document.getElementById('cs-axis').value.trim().split(/\s+/).map(Number);
        const angleDeg = parseFloat(angleInput.value);
        const range    = parseFloat(rangeInput.value);
        const op       = document.getElementById('cs-op').value;
        return { apex, axis, angleDeg, range, op };
    };

    // Selecionar
    document.getElementById('cs-select').addEventListener('click', () => {
        const { apex, axis, angleDeg, range, op } = getParams();
        const result = applyConeSeleciton(apex, axis, angleDeg, range, op);
        if (result.error) {
            statusEl.textContent = `Erro: ${result.error}`;
        } else {
            statusEl.textContent = `✓ ${result.inside} / ${result.total} gaussianas (${op})`;
        }
    });

    // Limpar seleção
    document.getElementById('cs-clear').addEventListener('click', () => {
        const scene = window.scene;
        const splats = scene?.elements?.filter(e => e.splatData) ?? [];
        if (!splats.length) { statusEl.textContent = 'Nenhum splat.'; return; }
        const splat = splats[0];
        const stateArr = splat.splatData.getProp('state');
        if (stateArr) { for (let i = 0; i < stateArr.length; i++) stateArr[i] &= ~1; }
        if (typeof splat.updateState === 'function') splat.updateState();
        else if (splat.stateTexture) {
            const tex = splat.stateTexture;
            const data = tex.lock();
            data.set(stateArr);
            tex.unlock();
        }
        scene.forceRender = true;
        statusEl.textContent = 'Seleção limpa.';
    });

    // Enviar ao bridge
    document.getElementById('cs-send').addEventListener('click', () => {
        const { apex, axis, angleDeg, range } = getParams();
        sendToBridge(statusEl, apex, axis, angleDeg, range);
    });

    console.log('[cone-selector] painel injetado com sucesso');
}

// Injetar imediatamente
injectPanel();
