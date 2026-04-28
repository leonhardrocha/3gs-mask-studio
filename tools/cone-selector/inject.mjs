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

import { sendOpacityFilteredPlyToBridge } from './serialize-selected-full.mjs';

// ---------------------------------------------------------------------------
// Configuração padrão do bridge
// ---------------------------------------------------------------------------
const BRIDGE_URL = 'http://localhost:3001/process-mask';

const PREVIEW_SEGMENTS = 32;
const NAV_GLYPH_RADIUS = 0.25;
const NAV_GLYPH_SEGMENTS = 40;
const previewState = {
    enabled: true,
    apex: [0, 0, 3],
    axis: [0, 0, -1],
    angleDeg: 30,
    range: 5,
    poseSpace: 'data' // 'data' (UI/manual) or 'render' (XR runtime pose)
};

const navDebugState = {
    enabled: false,
    axis: [0, 0], // [x, z]
    source: 'none'
};

let previewHookInstalled = false;

// O preview é desenhado no espaço visual do SuperSplat, que usa Y invertido
// em relação aos valores de coordenada usados nos campos/UI (3GS data-space).
// A seleção continua no data-space; apenas o glyph é convertido aqui.
function toPreviewRenderPoint(p) {
    return [p[0], -p[1], p[2]];
}

function toPreviewRenderAxis(a) {
    return norm([a[0], -a[1], a[2]]);
}

function norm(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len <= 1e-8) return [0, 0, -1];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function basisFromAxis(axis) {
    const w = norm(axis);
    const up = Math.abs(w[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([
        w[1] * up[2] - w[2] * up[1],
        w[2] * up[0] - w[0] * up[2],
        w[0] * up[1] - w[1] * up[0]
    ]);
    const v = [
        w[1] * u[2] - w[2] * u[1],
        w[2] * u[0] - w[0] * u[2],
        w[0] * u[1] - w[1] * u[0]
    ];
    return { u, v, w };
}

function buildConeLineArrays(apex, axis, angleDeg, range, segments = PREVIEW_SEGMENTS) {
    const tanA = Math.tan((angleDeg * Math.PI) / 180);
    const r = Math.max(0.001, range * tanA);
    const { u, v, w } = basisFromAxis(axis);

    const center = [
        apex[0] + w[0] * range,
        apex[1] + w[1] * range,
        apex[2] + w[2] * range
    ];

    const positions = [];
    const colors = [];
    const pushLine = (a, b, color) => {
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        colors.push(color[0], color[1], color[2], color[3], color[0], color[1], color[2], color[3]);
    };

    const ringColor = [0.15, 0.85, 1.0, 0.95];
    const axisColor = [1.0, 0.75, 0.2, 1.0];

    // axis line
    pushLine(apex, center, axisColor);

    let prev = null;
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const cs = Math.cos(t);
        const sn = Math.sin(t);

        const p = [
            center[0] + r * (u[0] * cs + v[0] * sn),
            center[1] + r * (u[1] * cs + v[1] * sn),
            center[2] + r * (u[2] * cs + v[2] * sn)
        ];

        // side line from apex to ring point (sparse to reduce clutter)
        if (i % Math.max(1, Math.floor(segments / 8)) === 0) {
            pushLine(apex, p, ringColor);
        }

        if (prev) pushLine(prev, p, ringColor);
        prev = p;
    }

    return { positions, colors };
}

function buildNavAxisDiskLineArrays(axis, radius = NAV_GLYPH_RADIUS, segments = NAV_GLYPH_SEGMENTS) {
    const cx = axis[0] ?? 0;
    const cz = axis[1] ?? 0;
    const cy = 0;

    const positions = [];
    const colors = [];
    const ringColor = [0.95, 0.25, 0.25, 1.0];
    const crossColor = [1.0, 0.95, 0.2, 1.0];

    const pushLine = (a, b, color) => {
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        colors.push(color[0], color[1], color[2], color[3], color[0], color[1], color[2], color[3]);
    };

    let prev = null;
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        const p = [
            cx + Math.cos(t) * radius,
            cy,
            cz + Math.sin(t) * radius
        ];
        if (prev) pushLine(prev, p, ringColor);
        prev = p;
    }

    const c = [cx, cy, cz];
    pushLine([c[0] - 0.03, c[1], c[2]], [c[0] + 0.03, c[1], c[2]], crossColor);
    pushLine([c[0], c[1], c[2] - 0.03], [c[0], c[1], c[2] + 0.03], crossColor);

    return { positions, colors };
}

function drawPreviewCone() {
    const scene = window.scene;
    const app = scene?.app;
    if (!scene || !app) return;

    const layer = scene.gizmoLayer ?? app.scene.defaultDrawLayer;

    if (previewState.enabled) {
        const apex = previewState.poseSpace === 'render'
            ? previewState.apex
            : toPreviewRenderPoint(previewState.apex);
        const axis = previewState.poseSpace === 'render'
            ? previewState.axis
            : toPreviewRenderAxis(previewState.axis);

        const { positions, colors } = buildConeLineArrays(apex, axis, previewState.angleDeg, previewState.range);
        if (positions.length) {
            app.drawLineArrays(positions, colors, true, layer);
        }
    }

    if (navDebugState.enabled) {
        const { positions, colors } = buildNavAxisDiskLineArrays(navDebugState.axis);
        if (positions.length) {
            app.drawLineArrays(positions, colors, true, layer);
        }
    }
}

function installPreviewHook() {
    if (previewHookInstalled) return;
    const app = window.scene?.app;
    if (!app) return;

    app.on('prerender', drawPreviewCone);
    previewHookInstalled = true;
}

function updatePreview(params = {}) {
    if (Array.isArray(params.apex) && params.apex.length === 3) {
        previewState.apex = params.apex.map(Number);
    }
    if (Array.isArray(params.axis) && params.axis.length === 3) {
        previewState.axis = params.axis.map(Number);
    }
    if (Number.isFinite(params.angleDeg)) {
        previewState.angleDeg = Number(params.angleDeg);
    }
    if (Number.isFinite(params.range)) {
        previewState.range = Number(params.range);
    }
    if (typeof params.enabled === 'boolean') {
        previewState.enabled = params.enabled;
    }
    if (params.poseSpace === 'render' || params.poseSpace === 'data') {
        previewState.poseSpace = params.poseSpace;
    } else {
        previewState.poseSpace = 'data';
    }

    installPreviewHook();
    if (window.scene) window.scene.forceRender = true;
}

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

function transformPointMat4(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = (m[3] * x) + (m[7] * y) + (m[11] * z) + m[15];
    const iw = w !== 0 ? (1 / w) : 1;
    return [
        ((m[0] * x) + (m[4] * y) + (m[8] * z) + m[12]) * iw,
        ((m[1] * x) + (m[5] * y) + (m[9] * z) + m[13]) * iw,
        ((m[2] * x) + (m[6] * y) + (m[10] * z) + m[14]) * iw
    ];
}

function transformDirectionMat4(m, d) {
    const x = d[0], y = d[1], z = d[2];
    return [
        (m[0] * x) + (m[4] * y) + (m[8] * z),
        (m[1] * x) + (m[5] * y) + (m[9] * z),
        (m[2] * x) + (m[6] * y) + (m[10] * z)
    ];
}

function toSplatLocalCone(splat, apex, axis) {
    const wt = splat?.entity?.getWorldTransform?.();
    if (!wt || typeof wt.clone !== 'function') {
        return { apexLocal: apex, axisLocal: axis };
    }

    try {
        const inv = wt.clone().invert();
        const m = inv?.data;
        if (!m) return { apexLocal: apex, axisLocal: axis };
        const apexLocal = transformPointMat4(m, apex);
        const axisLocal = norm(transformDirectionMat4(m, axis));
        return { apexLocal, axisLocal };
    } catch (_e) {
        return { apexLocal: apex, axisLocal: axis };
    }
}

// ---------------------------------------------------------------------------
// Aplicar seleção por cone no primeiro splat carregado no SuperSplat
// ---------------------------------------------------------------------------
function applyConeSeleciton(apex, axis, angleDeg, range, op, poseSpace = 'data') {
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

    // Cone vem em world/data-space do runtime; convertemos para o local do splat
    // para manter o mesmo sistema de coordenadas dos arrays x/y/z.
    const len = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2);
    const normAxis = len > 0 ? axis.map(v => v / len) : [0, 0, -1];
    const { apexLocal, axisLocal } = toSplatLocalCone(splat, apex, normAxis);

    let count = 0;
    for (let i = 0; i < n; i++) {
        const inside = pointInsideCone(x[i], y[i], z[i], apexLocal, axisLocal, tanA, range);
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

    // Atualizar preview do cone para refletir os parâmetros atuais
    updatePreview({ apex, axis: normAxis, angleDeg, range, poseSpace });

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
    statusEl.textContent = 'Exportando seleção completa...';

    // Nova via: usa a API oficial de export do SuperSplat para preservar
    // propriedades completas no PLY antes de enviar ao bridge.
    try {
        const exported = await sendOpacityFilteredPlyToBridge({
            bridgeUrl: BRIDGE_URL,
            filename: 'selection-opacity-tagged.ply',
            selectedOpacityRaw: 0.0,
            unselectedOpacityRaw: 1.0,
            opacityThresholdRaw: 0.0
        });

        if (exported?.ok) {
            statusEl.textContent = `Bridge OK (CLI opacity filter) — ${exported.count} gaussianas, ${exported.outputBytes} bytes`;
            return;
        }

        // Mantém implementação atual para visualização/compatibilidade.
        statusEl.textContent = `Fallback de exportação: ${exported?.error ?? 'erro desconhecido'}`;
    } catch (e) {
        statusEl.textContent = `Export completo falhou: ${e.message}`;
    }

    const result = serializeSelectedPly(apex, axis, angleDeg, range);
    if (!result) {
        statusEl.textContent = 'Erro: nenhuma gaussiana selecionada.';
        return;
    }

    statusEl.textContent = `Enviando (modo visual) ${result.count} gaussianas...`;
    try {
        const resp = await fetch(BRIDGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'x-input-filename': 'selected.ply'
            },
            body: result.buffer
        });
        const json = await resp.json();
        if (json.ok) {
            statusEl.textContent = `Bridge OK (modo visual) — ${json.outputBytes} bytes`;
        } else {
            statusEl.textContent = `Bridge erro (modo visual): ${json.error ?? JSON.stringify(json)}`;
        }
    } catch (e) {
        statusEl.textContent = `Fetch error (modo visual): ${e.message}`;
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
        <div id="gp-indicator" style="font-size:10px;color:#6b7280;margin-bottom:6px;">
            🎮 desconectado
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
        <label style="display:flex;align-items:center;gap:6px;margin:0 0 8px;">
            <input id="cs-preview" type="checkbox" checked>
            Mostrar cone (preview)
        </label>
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
    const previewToggle = document.getElementById('cs-preview');

    const getParams = () => {
        const apex = document.getElementById('cs-apex').value.trim().split(/\s+/).map(Number);
        const axis = document.getElementById('cs-axis').value.trim().split(/\s+/).map(Number);
        const angleDeg = parseFloat(angleInput.value);
        const range    = parseFloat(rangeInput.value);
        const op       = document.getElementById('cs-op').value;
        return { apex, axis, angleDeg, range, op };
    };

    const pushPreview = () => {
        const { apex, axis, angleDeg, range } = getParams();
        updatePreview({ apex, axis, angleDeg, range, enabled: previewToggle.checked });
    };

    document.getElementById('cs-apex').addEventListener('change', pushPreview);
    document.getElementById('cs-axis').addEventListener('change', pushPreview);
    angleInput.addEventListener('input', pushPreview);
    rangeInput.addEventListener('input', pushPreview);
    previewToggle.addEventListener('change', pushPreview);

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

    // Desenha o preview imediatamente ao abrir o painel
    pushPreview();

    // Inicia loop de polling do gamepad (idempotente)
    startGamepadLoop();

    console.log('[cone-selector] painel injetado com sucesso');
}

// ---------------------------------------------------------------------------
// Gamepad polling — atualiza cone aim/apex em tempo real via navigator.getGamepads()
// ---------------------------------------------------------------------------
const GP_DEADZONE    = 0.12;
const GP_NAV_DEADZONE = 0.06;
const GP_AIM_SPEED   = 0.018;  // rad/frame @ deflexão máxima
const GP_MOVE_SPEED  = 0.04;   // m/frame @ deflexão máxima
const GP_ANGLE_SPEED = 0.5;    // °/frame @ deflexão máxima

let gpLoopRunning = false;
let gpPrevButtons = [];
let xrPrevButtons = {
    trigger: false,
    clear: false,
    cycle: false
};
let xrGridVisibleBeforeSession = null;
let xrVisualLocomotionBase = null;
let xrVisualLocomotionOffset = [0, 0, 0];
let gpLastTs = 0;
const OP_CYCLE = ['add', 'set', 'remove'];

function gpDeadZone(v) {
    if (Math.abs(v) < GP_DEADZONE) return 0;
    return (v - Math.sign(v) * GP_DEADZONE) / (1 - GP_DEADZONE);
}

/** Rodrigues rotation of vector v around unit axis k by rad radians */
function rotateVec(v, k, rad) {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dot = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
    const cx  = k[1] * v[2] - k[2] * v[1];
    const cy  = k[2] * v[0] - k[0] * v[2];
    const cz  = k[0] * v[1] - k[1] * v[0];
    return [
        v[0] * cos + cx * sin + k[0] * dot * (1 - cos),
        v[1] * cos + cy * sin + k[1] * dot * (1 - cos),
        v[2] * cos + cz * sin + k[2] * dot * (1 - cos)
    ];
}

function fmt3(arr) {
    return arr.map(v => v.toFixed(3)).join(' ');
}

/** Sync panel text fields from previewState (called each frame there is gamepad input) */
function updatePanelFromPreview() {
    const apexEl  = document.getElementById('cs-apex');
    const axisEl  = document.getElementById('cs-axis');
    const angleEl = document.getElementById('cs-angle');
    const angleValEl = document.getElementById('cs-angle-val');
    const rangeEl = document.getElementById('cs-range');
    const rangeValEl = document.getElementById('cs-range-val');
    if (!apexEl) return;
    apexEl.value = fmt3(previewState.apex);
    axisEl.value = fmt3(previewState.axis);
    if (angleEl) {
        angleEl.value = previewState.angleDeg;
        if (angleValEl) angleValEl.textContent = previewState.angleDeg.toFixed(1);
    }
    if (rangeEl) {
        rangeEl.value = previewState.range;
        if (rangeValEl) rangeValEl.textContent = previewState.range.toFixed(1);
    }
}

function gpIsPressed(btn) { return btn?.pressed ?? false; }
function gpJustPressed(btn, idx) {
    const cur  = gpIsPressed(btn);
    const prev = !!gpPrevButtons[idx];
    return cur && !prev;
}

function xrButtonPressed(src, gp, index) {
    if (src && typeof src.getButton === 'function') {
        const v = src.getButton(index);
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v > 0.5;
    }
    const btn = gp?.buttons?.[index];
    if (!btn) return false;
    if (typeof btn === 'number') return btn > 0.5;
    if (typeof btn.pressed === 'boolean') return btn.pressed;
    return Number(btn.value ?? 0) > 0.5;
}

function getXrSources() {
    const app = window.scene?.app;
    const input = app?.xr?.input;
    const sources = input?.inputSources || [];
    if (!sources.length) return { primary: null, left: null, right: null, all: [] };

    const classifyHand = (s) => {
        const hand = String(s?.handedness || '').toLowerCase();
        if (hand === 'left' || hand === 'right') return hand;

        const profileStr = Array.isArray(s?.profiles) ? s.profiles.join(' ').toLowerCase() : '';
        if (profileStr.includes('left')) return 'left';
        if (profileStr.includes('right')) return 'right';

        const gpId = String(s?.gamepad?.id || '').toLowerCase();
        if (gpId.includes('left')) return 'left';
        if (gpId.includes('right')) return 'right';

        return 'unknown';
    };

    const right = sources.find((s) => classifyHand(s) === 'right');
    const left = sources.find((s) => classifyHand(s) === 'left');
    return {
        primary: right || left || sources[0] || null,
        left: left || null,
        right: right || null,
        all: sources
    };
}

function pickXrNavSource(xrSources, xrAimSource) {
    const all = xrSources?.all || [];
    const left = xrSources?.left || null;
    if (left?.gamepad && left !== xrAimSource) return left;

    // fallback: any non-aim source with gamepad (for runtimes with ambiguous handedness)
    const alt = all.find((s) => s !== xrAimSource && s?.gamepad && (s?.gamepad?.axes?.length ?? 0) >= 2);
    if (alt) return alt;

    return left || xrAimSource || null;
}

function readPreferredStick(axes = []) {
    const a0x = gpDeadZone(axes[0] ?? 0);
    const a0y = gpDeadZone(axes[1] ?? 0);
    const a1x = gpDeadZone(axes[2] ?? 0);
    const a1y = gpDeadZone(axes[3] ?? 0);
    const m0 = Math.hypot(a0x, a0y);
    const m1 = Math.hypot(a1x, a1y);
    if (m1 > m0) return [a1x, a1y];
    return [a0x, a0y];
}

function applyDeadZoneAxis(v, dz = GP_NAV_DEADZONE) {
    if (!Number.isFinite(v)) return 0;
    if (Math.abs(v) < dz) return 0;
    return (v - Math.sign(v) * dz) / (1 - dz);
}

function readNavAxesFromGamepad(gamepad) {
    const axes = gamepad?.axes || [];
    const r20 = [Number(axes[2] ?? 0), Number(axes[3] ?? 0)];
    const r01 = [Number(axes[0] ?? 0), Number(axes[1] ?? 0)];

    // Muitos runtimes XR usam 2/3 para thumbstick; alguns usam 0/1.
    const raw = Math.hypot(r20[0], r20[1]) >= Math.hypot(r01[0], r01[1]) ? r20 : r01;
    return [applyDeadZoneAxis(raw[0]), applyDeadZoneAxis(raw[1])];
}

function readXrNavAxes(xrNavSource, xrAimSource) {
    // 1) Prefer explicit XR left source
    let axes = readNavAxesFromGamepad(xrNavSource?.gamepad);
    if (Math.hypot(axes[0], axes[1]) > 1e-4) return { axes, source: 'xr-left' };

    // 2) Try any non-aim XR source gamepad
    const sources = window.scene?.app?.xr?.input?.inputSources || [];
    for (const s of sources) {
        if (s === xrAimSource) continue;
        const a = readNavAxesFromGamepad(s?.gamepad);
        if (Math.hypot(a[0], a[1]) > 1e-4) return { axes: a, source: 'xr-alt' };
    }

    // 3) WebXR gamepad fallback (some runtimes expose stick only here)
    const pads = getConnectedGamepads();
    const leftCandidates = pads.filter((p) => {
        const hand = String(p?.hand || '').toLowerCase();
        const mapping = String(p?.mapping || '').toLowerCase();
        const id = String(p?.id || '').toLowerCase();
        return hand === 'left' || mapping === 'xr-standard' || id.includes('left');
    });

    for (const p of leftCandidates) {
        const a = readNavAxesFromGamepad(p);
        if (Math.hypot(a[0], a[1]) > 1e-4) return { axes: a, source: `gp-left#${p.index}` };
    }

    // 4) last fallback
    axes = readNavAxesFromGamepad((xrNavSource || xrAimSource)?.gamepad);
    return { axes, source: 'fallback' };
}

function getBestXrMoveAxes(xrSources) {
    const all = xrSources?.all || [];

    // Preferir mão esquerda para locomoção quando disponível.
    const ordered = [];
    if (xrSources?.left) ordered.push(xrSources.left);
    for (const s of all) {
        if (!ordered.includes(s)) ordered.push(s);
    }

    let best = [0, 0];
    let bestMag = 0;
    for (const s of ordered) {
        const axes = s?.gamepad?.axes || [];
        const v = readPreferredStick(axes);
        const m = Math.hypot(v[0], v[1]);
        if (m > bestMag) {
            best = v;
            bestMag = m;
        }
    }

    return best;
}

function getConnectedGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    for (const p of pads) {
        if (p && p.connected) out.push(p);
    }
    return out;
}

function getGamepadHand(pad) {
    const hand = String(pad?.hand || '').toLowerCase();
    if (hand === 'left' || hand === 'right') return hand;

    const id = String(pad?.id || '').toLowerCase();
    if (id.includes('left')) return 'left';
    if (id.includes('right')) return 'right';
    return 'unknown';
}

function resolveDesktopGamepadRoles(connectedPads) {
    const right = connectedPads.find((p) => getGamepadHand(p) === 'right') || null;
    const left = connectedPads.find((p) => getGamepadHand(p) === 'left') || null;

    const aim = right || connectedPads[0] || null;
    const nav = left || aim;

    const dual = Boolean(aim && nav && aim !== nav);
    const aimLabel = aim ? `${getGamepadHand(aim)}#${aim.index}` : 'none';
    const navLabel = nav ? `${getGamepadHand(nav)}#${nav.index}` : 'none';
    const label = dual ? `dual aim:${aimLabel} nav:${navLabel}` : (aim ? `single ${aim.id.slice(0, 24)}` : 'desconectado');

    return { aim, nav, dual, label };
}

function syncPreviewToXrController(xrSources) {
    const source = xrSources?.right || xrSources?.primary || xrSources?.left || null;
    if (!source) return false;

    const pose = getXrPose(source);
    if (!pose) return false;

    previewState.apex = pose.origin;
    previewState.axis = pose.direction;
    previewState.poseSpace = 'render';
    updatePanelFromPreview();
    installPreviewHook();
    if (window.scene) window.scene.forceRender = true;
    return true;
}

function getHeadForward(cam, Vec3) {
    const ent = cam?.mainCamera;
    const f = ent?.forward;
    if (f) {
        return norm([f.x, f.y, f.z]);
    }

    const zAxis = new Vec3(0, 0, 1);
    const wt = ent?.getWorldTransform?.();
    if (wt) {
        wt.getZ(zAxis);
        return norm([-zAxis.x, -zAxis.y, -zAxis.z]);
    }

    return [0, 0, -1];
}

function getXrCameraEntity() {
    const app = window.scene?.app;
    const xrCam = app?.xr?.camera;
    return xrCam?.entity || xrCam || window.scene?.camera?.mainCamera || null;
}

function getXrRigEntity() {
    const scene = window.scene;
    const xrCamEntity = getXrCameraEntity();
    return xrCamEntity?.parent || scene?.cameraRoot || null;
}

function getXrMoveBasis() {
    const camEntity = getXrCameraEntity();
    if (!camEntity) {
        return {
            forward: [0, 0, -1],
            right: [1, 0, 0]
        };
    }

    const f = camEntity.forward;
    const r = camEntity.right;
    const forward = norm([f?.x ?? 0, 0, f?.z ?? -1]);
    const right = norm([r?.x ?? 1, 0, r?.z ?? 0]);
    return { forward, right };
}

function beginXrVisualLocomotion() {
    const rig = getXrRigEntity();
    if (!rig) return false;

    const p = rig.getLocalPosition ? rig.getLocalPosition() : rig.getPosition?.();
    if (!p) return false;

    xrVisualLocomotionBase = [p.x, p.y, p.z];
    xrVisualLocomotionOffset = [0, 0, 0];
    return true;
}

function resetXrVisualLocomotion() {
    const rig = getXrRigEntity();
    if (rig && Array.isArray(xrVisualLocomotionBase)) {
        if (rig.setLocalPosition) {
            rig.setLocalPosition(
                xrVisualLocomotionBase[0],
                xrVisualLocomotionBase[1],
                xrVisualLocomotionBase[2]
            );
        } else if (rig.setPosition) {
            rig.setPosition(
                xrVisualLocomotionBase[0],
                xrVisualLocomotionBase[1],
                xrVisualLocomotionBase[2]
            );
        }
    }
    xrVisualLocomotionBase = null;
    xrVisualLocomotionOffset = [0, 0, 0];
}

function getXrPose(source) {
    if (!source) return null;

    if (typeof source.getOrigin === 'function' && typeof source.getDirection === 'function') {
        const o = source.getOrigin();
        const d = source.getDirection();
        if (o && d) {
            return {
                origin: [o.x, o.y, o.z],
                direction: norm([d.x, d.y, d.z])
            };
        }
    }

    if (typeof source.getPosition === 'function' && typeof source.getRotation === 'function') {
        const p = source.getPosition();
        const r = source.getRotation();
        if (p && r && window.pc?.Quat) {
            const q = new window.pc.Quat(r.x, r.y, r.z, r.w);
            const dir = new window.pc.Vec3(0, 0, -1);
            q.transformVector(dir, dir);
            return {
                origin: [p.x, p.y, p.z],
                direction: norm([dir.x, dir.y, dir.z])
            };
        }
    }

    return null;
}

function moveObserverByLeftStick(stickX, stickY, dt = 1 / 60) {
    const rig = getXrRigEntity();
    if (!rig) return null;

    if (!Array.isArray(xrVisualLocomotionBase)) {
        beginXrVisualLocomotion();
    }
    if (!Array.isArray(xrVisualLocomotionBase)) return null;

    if (stickX === 0 && stickY === 0) return null;

    // No XR, mover o rig (pai da câmera), não a câmera.
    const { forward, right } = getXrMoveBasis();
    const moveSpeed = 2.0 * Math.max(1 / 120, Math.min(1 / 20, dt));

    const dx = stickX * right[0] * moveSpeed + (-stickY) * forward[0] * moveSpeed;
    const dz = stickX * right[2] * moveSpeed + (-stickY) * forward[2] * moveSpeed;

    xrVisualLocomotionOffset[0] += dx;
    xrVisualLocomotionOffset[2] += dz;

    if (rig.setLocalPosition) {
        rig.setLocalPosition(
            xrVisualLocomotionBase[0] + xrVisualLocomotionOffset[0],
            xrVisualLocomotionBase[1],
            xrVisualLocomotionBase[2] + xrVisualLocomotionOffset[2]
        );
    } else if (rig.setPosition) {
        rig.setPosition(
            xrVisualLocomotionBase[0] + xrVisualLocomotionOffset[0],
            xrVisualLocomotionBase[1],
            xrVisualLocomotionBase[2] + xrVisualLocomotionOffset[2]
        );
    }

    return [dx, 0, dz];
}

function positionObserverForSelection() {
    const scene = window.scene;
    const cam = scene?.camera;
    const Vec3 = window.pc?.Vec3;
    if (!scene || !cam || !Vec3 || typeof cam.setPose !== 'function') return;

    const bound = scene.bound;
    const center = bound?.center;
    const halfExtents = bound?.halfExtents;
    if (!center || !halfExtents) return;

    const radius = Math.max(0.5, Math.hypot(halfExtents.x, halfExtents.y, halfExtents.z));
    const distance = Math.max(2.0, radius * 2.0);

    // XR sobrescreve a pose local da câmera a cada frame com a pose do HMD.
    // Para garantir que a cena fique à frente na entrada, reposicionamos o
    // cameraRoot usando o forward atual da cabeça.
    const xrActive = Boolean(scene?.app?.xr?.active);
    const rig = getXrRigEntity();
    if (xrActive && rig?.getPosition && rig?.setPosition) {
        const headPos = cam.mainCamera?.getPosition?.();
        if (headPos) {
            const fwd = getHeadForward(cam, Vec3);

            const desiredHead = [
                center.x - fwd[0] * distance,
                center.y - fwd[1] * distance,
                center.z - fwd[2] * distance
            ];

            const delta = [
                desiredHead[0] - headPos.x,
                desiredHead[1] - headPos.y,
                desiredHead[2] - headPos.z
            ];

            const rp = rig.getPosition();
            rig.setPosition(rp.x + delta[0], rp.y + delta[1], rp.z + delta[2]);

            // Mantém orbit consistente para quando sair do XR.
            cam.setFocalPoint(new Vec3(center.x, center.y, center.z), 0);
            return;
        }
    }

    // Keep current viewing side, but force look-at to the splat center.
    const currentPos = cam.mainCamera?.getPosition?.();
    let dir = [0, 0, 1];
    if (currentPos) {
        dir = norm([
            currentPos.x - center.x,
            currentPos.y - center.y,
            currentPos.z - center.z
        ]);
    }

    const pos = new Vec3(
        center.x + dir[0] * distance,
        center.y + dir[1] * distance,
        center.z + dir[2] * distance
    );
    const target = new Vec3(center.x, center.y, center.z);

    cam.setPose(pos, target, 0);
}

function setGridVisible(visible) {
    const scene = window.scene;
    if (!scene) return;

    if (scene.events?.fire) {
        scene.events.fire('grid.setVisible', visible);
        return;
    }

    if (scene.grid) {
        scene.grid.visible = visible;
    }
}

function cycleOperationMode() {
    const opEl = document.getElementById('cs-op');
    if (!opEl) return;
    const cur = OP_CYCLE.indexOf(opEl.value);
    opEl.value = OP_CYCLE[(cur + 1) % OP_CYCLE.length];
}

function applySelectionFromPreview() {
    const op = document.getElementById('cs-op')?.value ?? 'add';
    const apex = previewState.poseSpace === 'render'
        ? previewState.apex
        : toPreviewRenderPoint(previewState.apex);
    const axis = previewState.poseSpace === 'render'
        ? norm(previewState.axis)
        : toPreviewRenderAxis(previewState.axis);
    const result = applyConeSeleciton(
        apex,
        axis,
        previewState.angleDeg,
        previewState.range,
        op,
        previewState.poseSpace
    );
    const statusEl = document.getElementById('cs-status');
    if (statusEl) {
        statusEl.textContent = result.error
            ? `Erro: ${result.error}`
            : `✓ ${result.inside} / ${result.total} gaussianas (${op})`;
    }
}

function startGamepadLoop() {
    if (gpLoopRunning) return;
    gpLoopRunning = true;

    function loop() {
        const app = window.scene?.app;
        const nowTs = performance.now();
        const dt = gpLastTs > 0 ? (nowTs - gpLastTs) / 1000 : (1 / 60);
        gpLastTs = nowTs;

        const xrActive = Boolean(app?.xr?.active);
        const xrSources = xrActive ? getXrSources() : null;
        const xrAimSource = xrSources?.right || xrSources?.primary || null;
        const xrNavSource = pickXrNavSource(xrSources, xrAimSource);
        const xrSource = xrAimSource;

        const connectedPads = getConnectedGamepads();
        const desktopPads = resolveDesktopGamepadRoles(connectedPads);
        const gp = desktopPads.aim;

        const indicator = document.getElementById('gp-indicator');
        if (indicator) {
            if (xrSource) {
                indicator.style.color = '#22d3ee';
                const hasLeft = Boolean(xrSources?.left);
                const hasRight = Boolean(xrSources?.right);
                const navLabel = xrNavSource ? String(xrNavSource.handedness || 'source') : 'none';
                const aimLabel = xrAimSource ? String(xrAimSource.handedness || 'source') : 'none';
                const pair = hasLeft && hasRight ? 'L+R' : (hasRight ? 'R' : (hasLeft ? 'L' : '1x'));
                indicator.textContent = `XR ${pair} aim:${aimLabel} nav:${navLabel}`;
            } else {
                indicator.style.color = gp ? '#4ade80' : '#6b7280';
                indicator.textContent = gp ? `🎮 ${desktopPads.label}` : '🎮 desconectado';
            }
        }

        // XR controller path (preferred while XR session is active)
        if (xrSource) {
            const pose = getXrPose(xrSource);
            const gpXr = xrSource.gamepad || null;
            let dirty = false;

            if (pose) {
                previewState.apex = pose.origin;
                previewState.axis = pose.direction;
                previewState.poseSpace = 'render';
                dirty = true;
            }

            // Controle direito: mira/ações. Controle esquerdo: navegação.
            const navResolved = readXrNavAxes(xrNavSource, xrAimSource);
            const navAxes = navResolved.axes;
            const [lstX, lstY] = navAxes;
            navDebugState.enabled = true;
            navDebugState.axis = [lstX, lstY];
            navDebugState.source = navResolved.source;

            if (indicator && xrSource) {
                indicator.textContent += ` navAxis:${lstX.toFixed(2)},${lstY.toFixed(2)} src:${navResolved.source}`;
            }

            const aimAxes = gpXr?.axes || [];
            const rangeAxis = gpDeadZone(aimAxes.length >= 4 ? (aimAxes[3] ?? 0) : 0);
            const angleAxis = gpDeadZone(aimAxes.length >= 4 ? (aimAxes[2] ?? 0) : 0);
            const observerDelta = moveObserverByLeftStick(lstX, lstY, dt);
            if (observerDelta) {
                dirty = true;
            }
            if (rangeAxis !== 0) {
                previewState.range = Math.min(20, Math.max(0.1, previewState.range + (-rangeAxis * 0.08)));
                dirty = true;
            }
            if (angleAxis !== 0) {
                previewState.angleDeg = Math.min(90, Math.max(1, previewState.angleDeg + (angleAxis * 0.6)));
                dirty = true;
            }

            const trigger = xrButtonPressed(xrSource, gpXr, 0) || Boolean(xrSource.selecting);
            const clear = xrButtonPressed(xrSource, gpXr, 1) || xrButtonPressed(xrSource, gpXr, 4);
            const cycle = xrButtonPressed(xrSource, gpXr, 2) || xrButtonPressed(xrSource, gpXr, 5);

            if (trigger && !xrPrevButtons.trigger) {
                applySelectionFromPreview();
            }
            if (clear && !xrPrevButtons.clear) {
                document.getElementById('cs-clear')?.click();
            }
            if (cycle && !xrPrevButtons.cycle) {
                cycleOperationMode();
            }

            xrPrevButtons.trigger = trigger;
            xrPrevButtons.clear = clear;
            xrPrevButtons.cycle = cycle;

            if (dirty) {
                updatePanelFromPreview();
                installPreviewHook();
                if (window.scene) window.scene.forceRender = true;
            }

            // Do not mix desktop mapping while XR is active.
            gpPrevButtons = [];
            requestAnimationFrame(loop);
            return;
        }

        xrPrevButtons.trigger = false;
        xrPrevButtons.clear = false;
        xrPrevButtons.cycle = false;
        navDebugState.enabled = false;

        if (gp) {
            const aimPad = desktopPads.aim;
            const navPad = desktopPads.nav;
            const aimAxes = aimPad?.axes || [];
            const navAxes = readNavAxesFromGamepad(navPad);
            const buttons = aimPad?.buttons || [];

            // Right stick (axes 2/3) → aim direction (yaw / pitch)
            const rstX = gpDeadZone(aimAxes[2] ?? 0);
            const rstY = gpDeadZone(aimAxes[3] ?? 0);

            // Navegação usa o segundo controle (left) quando disponível.
            const lstX = navAxes[0] ?? 0;
            const lstY = navAxes[1] ?? 0;

            let dirty = false;

            if (rstX !== 0 || rstY !== 0) {
                let axis = previewState.axis.slice();
                // Yaw: rotate around world Y
                if (rstX !== 0) {
                    axis = rotateVec(axis, [0, 1, 0], -rstX * GP_AIM_SPEED);
                }
                // Pitch: rotate around local right vector (perpendicular to axis in XZ)
                if (rstY !== 0) {
                    const right = norm([-axis[2], 0, axis[0]]);
                    axis = rotateVec(axis, right, rstY * GP_AIM_SPEED);
                }
                previewState.axis = norm(axis);
                dirty = true;
            }

            if (lstX !== 0 || lstY !== 0) {
                const fwd   = previewState.axis;
                const right = norm([-fwd[2], 0, fwd[0]]);
                previewState.apex = [
                    previewState.apex[0] + lstX * right[0] * GP_MOVE_SPEED - lstY * fwd[0] * GP_MOVE_SPEED,
                    previewState.apex[1] + lstX * right[1] * GP_MOVE_SPEED - lstY * fwd[1] * GP_MOVE_SPEED,
                    previewState.apex[2] + lstX * right[2] * GP_MOVE_SPEED - lstY * fwd[2] * GP_MOVE_SPEED
                ];
                dirty = true;
            }

            // LB (button 4) / RB (button 5) → adjust cone angle
            if (gpIsPressed(buttons[4])) {
                previewState.angleDeg = Math.max(1, previewState.angleDeg - GP_ANGLE_SPEED);
                dirty = true;
            }
            if (gpIsPressed(buttons[5])) {
                previewState.angleDeg = Math.min(90, previewState.angleDeg + GP_ANGLE_SPEED);
                dirty = true;
            }

            // L3 (button 10) / R3 (button 11) → adjust range
            if (gpIsPressed(buttons[10])) {
                previewState.range = Math.max(0.1, previewState.range - 0.05);
                dirty = true;
            }
            if (gpIsPressed(buttons[11])) {
                previewState.range = Math.min(20, previewState.range + 0.05);
                dirty = true;
            }

            // A/Cross (button 0) → apply selection (rising edge only)
            if (gpJustPressed(buttons[0], 0)) {
                applySelectionFromPreview();
            }

            // B/Circle (button 1) → clear selection (rising edge)
            if (gpJustPressed(buttons[1], 1)) {
                document.getElementById('cs-clear')?.click();
            }

            // Y/Triangle (button 3) → cycle operation mode (rising edge)
            if (gpJustPressed(buttons[3], 3)) {
                cycleOperationMode();
            }

            gpPrevButtons = Array.from(buttons).map(b => b?.pressed ?? false);

            if (dirty) {
                updatePanelFromPreview();
                installPreviewHook();
                if (window.scene) window.scene.forceRender = true;
            }
        } else {
            gpPrevButtons = [];
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

function resolveXrCameraComponent() {
    const scene = window.scene;
    const app = scene?.app;

    const direct = scene?.camera?.camera
        || scene?.cameraEntity?.camera
        || scene?.camera?.entity?.camera;
    if (direct) return direct;

    const list = app?.root?.findComponents?.('camera');
    if (Array.isArray(list) && list.length) return list[0];

    return null;
}

function getXrTypeConst(type) {
    if (window.pc?.XRTYPE_VR && type === 'immersive-vr') return window.pc.XRTYPE_VR;
    if (window.pc?.XRTYPE_AR && type === 'immersive-ar') return window.pc.XRTYPE_AR;
    return type;
}

function getXrSpaceConst(space) {
    if (window.pc?.XRSPACE_LOCALFLOOR && space === 'local-floor') return window.pc.XRSPACE_LOCALFLOOR;
    if (window.pc?.XRSPACE_LOCAL && space === 'local') return window.pc.XRSPACE_LOCAL;
    if (window.pc?.XRSPACE_VIEWER && space === 'viewer') return window.pc.XRSPACE_VIEWER;
    return space;
}

function getXrStatus() {
    const app = window.scene?.app;
    const xr = app?.xr;
    if (!xr) {
        return {
            ok: false,
            supported: false,
            active: false,
            availableVr: false,
            reason: 'xr-manager-missing',
            message: 'XR manager não disponível neste runtime do SuperSplat (build sem XrManager).'
        };
    }

    const vrType = getXrTypeConst('immersive-vr');
    const supported = Boolean(xr.supported);
    const availableVr = supported && typeof xr.isAvailable === 'function' ? xr.isAvailable(vrType) : false;

    return {
        ok: true,
        supported,
        active: Boolean(xr.active),
        availableVr,
        type: xr.type || xr._type || null,
        spaceType: xr.spaceType || xr._spaceType || null
    };
}

function startXrSession({ type = 'immersive-vr', space = 'local-floor' } = {}) {
    return new Promise((resolve, reject) => {
        const app = window.scene?.app;
        const xr = app?.xr;
        if (!xr) {
            reject(new Error('XR manager não disponível neste runtime do SuperSplat (build sem XrManager).'));
            return;
        }

        const xrType = getXrTypeConst(type);
        // Para VR locomotion, preferimos sempre local-floor.
        const xrSpace = getXrSpaceConst(type === 'immersive-vr' ? 'local-floor' : space);
        const camera = resolveXrCameraComponent();

        if (!xr.supported) {
            reject(new Error('WebXR não suportado neste navegador/contexto.'));
            return;
        }
        if (!camera) {
            reject(new Error('Nenhuma câmera encontrada para iniciar sessão XR.'));
            return;
        }
        if (typeof xr.isAvailable === 'function' && !xr.isAvailable(xrType)) {
            reject(new Error(`Sessão XR indisponível para tipo "${xrType}".`));
            return;
        }

        xr.start(camera, xrType, xrSpace, {
            callback: (err) => {
                if (err) {
                    reject(err);
                } else {
                    if (xrGridVisibleBeforeSession === null) {
                        xrGridVisibleBeforeSession = Boolean(window.scene?.grid?.visible);
                    }
                    setGridVisible(false);
                    beginXrVisualLocomotion();
                    const xrSources = getXrSources();
                    syncPreviewToXrController(xrSources);
                    positionObserverForSelection();
                    // Reaplica no primeiro frame XR válido para usar pose real do HMD.
                    xr.once?.('update', () => {
                        const freshSources = getXrSources();
                        syncPreviewToXrController(freshSources);
                        positionObserverForSelection();
                    });
                    if (window.scene) window.scene.forceRender = true;
                    resolve(getXrStatus());
                }
            }
        });
    });
}

function endXrSession() {
    const app = window.scene?.app;
    const xr = app?.xr;
    if (!xr) return { ok: false, message: 'XR manager não disponível no app atual.' };
    if (xr.active && typeof xr.end === 'function') {
        xr.end();
    }
    if (xrGridVisibleBeforeSession !== null) {
        setGridVisible(xrGridVisibleBeforeSession);
        xrGridVisibleBeforeSession = null;
    }
    resetXrVisualLocomotion();
    if (window.scene) window.scene.forceRender = true;
    return getXrStatus();
}

// ---------------------------------------------------------------------------
// postMessage bridge — permite controle cross-origin a partir do wrapper
// ---------------------------------------------------------------------------
window.addEventListener('message', (event) => {
    // Aceitar apenas mensagens com namespace 'coneSelector'
    if (!event.data || event.data.ns !== 'coneSelector') return;

    const { cmd, payload, id } = event.data;
    const reply = (data) => event.source?.postMessage({ ns: 'coneSelectorReply', id, ...data }, '*');

    if (cmd === 'ping') {
        reply({ ok: true });
        return;
    }

    if (cmd === 'select') {
        const { apex, axis, angleDeg, range, op } = payload;
        const result = applyConeSeleciton(apex, axis, angleDeg, range, op);
        reply(result.error ? { error: result.error } : { ok: true, inside: result.inside, total: result.total });
        return;
    }

    if (cmd === 'clear') {
        const scene = window.scene;
        const splats = scene?.elements?.filter(e => e.splatData) ?? [];
        if (!splats.length) { reply({ error: 'Nenhum splat.' }); return; }
        const splat = splats[0];
        const stateArr = splat.splatData.getProp('state');
        if (stateArr) for (let i = 0; i < stateArr.length; i++) stateArr[i] &= ~1;
        if (typeof splat.updateState === 'function') splat.updateState();
        else if (splat.stateTexture) {
            const data = splat.stateTexture.lock(); data.set(stateArr); splat.stateTexture.unlock();
        }
        scene.forceRender = true;
        reply({ ok: true });
        return;
    }

    if (cmd === 'serializeFull') {
        sendOpacityFilteredPlyToBridge({
            bridgeUrl: payload?.bridgeUrl || BRIDGE_URL,
            filename: payload?.filename || 'selection-opacity-tagged.ply',
            selectedOpacityRaw: Number(payload?.selectedOpacityRaw ?? 0.0),
            unselectedOpacityRaw: Number(payload?.unselectedOpacityRaw ?? 1.0),
            opacityThresholdRaw: Number(payload?.opacityThresholdRaw ?? 0.0)
        }).then((result) => {
            if (!result?.ok) {
                reply({ error: result?.error || 'Falha ao exportar seleção completa.' });
                return;
            }
            reply({ ok: true, count: result.count, outputBytes: result.outputBytes, outputPath: result.outputPath });
        }).catch((err) => {
            reply({ error: err?.message || String(err) });
        });
        return;
    }

    if (cmd === 'serialize') {
        const result = serializeSelectedPly();
        if (!result) { reply({ error: 'Nenhuma gaussiana selecionada.' }); return; }
        // Transferir buffer diretamente (zero-copy via Transferable)
        event.source?.postMessage(
            { ns: 'coneSelectorReply', id, ok: true, count: result.count, buffer: result.buffer },
            '*',
            [result.buffer]
        );
        return;
    }

    if (cmd === 'autoApex') {
        reply({ ok: true, apex: getDefaultApex() });
        return;
    }

    if (cmd === 'preview') {
        updatePreview(payload ?? {});
        reply({ ok: true });
        return;
    }

    if (cmd === 'xrStatus') {
        reply(getXrStatus());
        return;
    }

    if (cmd === 'xrStart') {
        startXrSession(payload ?? {})
            .then((status) => reply({ ok: true, ...status }))
            .catch((err) => reply({ error: err?.message || String(err) }));
        return;
    }

    if (cmd === 'xrEnd') {
        reply(endXrSession());
        return;
    }

    if (cmd === 'xrToggle') {
        const xr = window.scene?.app?.xr;
        if (xr?.active) {
            reply(endXrSession());
            return;
        }
        startXrSession(payload ?? {})
            .then((status) => reply({ ok: true, ...status }))
            .catch((err) => reply({ error: err?.message || String(err) }));
        return;
    }
});

// Injetar imediatamente
injectPanel();
