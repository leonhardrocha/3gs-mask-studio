/**
 * vr-masker.mjs — Script PlayCanvas Engine para seleção de Gaussian Splats
 * por interseção de cone em VR (ou fallback de câmera em desktop).
 *
 * Como funciona:
 *  - A cada frame, enquanto o trigger VR estiver pressionado (ou botão Space
 *    em desktop), calcula quais splats estão dentro de um cone definido por:
 *      apex  = posição do controlador (ou câmera)
 *      axis  = direção -Z do controlador (ou câmera forward)
 *      angle = coneAngleDeg
 *      range = coneRange
 *  - O conjunto de índices selecionados é acumulado.
 *  - Ao soltar o trigger, exporta um PLY binário com os splats marcados via
 *    opacity raw (+100 = selecionado, -100 = não selecionado) e envia ao
 *    bridge server via POST /process-mask.
 *
 * API pública (propriedades do script):
 *  coneAngleDeg  {number}  ângulo do cone em graus          (padrão: 30)
 *  coneRange     {number}  profundidade máxima do cone (m)  (padrão: 5)
 *  bridgeUrl     {string}  URL do bridge server              (padrão: abaixo)
 *  autoSendOnStop{boolean} envia ao bridge ao soltar trigger (padrão: true)
 *
 * Eventos emitidos (this.fire):
 *  'selected:update'  (count: number)        — a cada mudança no conjunto
 *  'bridge:success'   (result: object)        — resposta OK do bridge
 *  'bridge:error'     (message: string)       — falha no bridge
 */

import * as pc from '../../engine/build/playcanvas/src/index.js';

export const BRIDGE_DEFAULT_URL = 'http://localhost:3001/process-mask';

// ---------------------------------------------------------------------------
// Predicado de cone — ponto p está dentro do cone definido por apex+axis?
// ---------------------------------------------------------------------------
function pointInsideCone(p, apex, axis, tanAngle, maxRange) {
    const dx = p.x - apex.x;
    const dy = p.y - apex.y;
    const dz = p.z - apex.z;

    // profundidade ao longo do eixo
    const t = dx * axis.x + dy * axis.y + dz * axis.z;
    if (t < 0 || t > maxRange) return false;

    // distância radial ao quadrado
    const rx = dx - t * axis.x;
    const ry = dy - t * axis.y;
    const rz = dz - t * axis.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    const limit = t * tanAngle;
    return r2 <= limit * limit;
}

// ---------------------------------------------------------------------------
// Exportador PLY binário mínimo — marca opacity raw para filtro CLI
// ---------------------------------------------------------------------------
function exportMaskedPly(splatData, selectedSet) {
    const count = splatData.numSplats;
    // Colunas obrigatórias: x y z (f32) + opacity_raw (f32)
    // Reutiliza todas as propriedades existentes e sobrescreve opacity_raw
    const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2',
                   'scale_0', 'scale_1', 'scale_2',
                   'rot_0', 'rot_1', 'rot_2', 'rot_3',
                   'opacity'];

    // Colunas float32 disponíveis no GSplatData
    const available = props.filter(p => splatData.hasElement('vertex', p));

    const stride = available.length + 1; // +1 para opacity_raw
    const buf = new Float32Array(count * stride);

    for (let i = 0; i < count; i++) {
        let off = i * stride;
        for (const col of available) {
            buf[off++] = splatData.getElement('vertex', col, i);
        }
        // opacity_raw: selecionado = +100, não selecionado = -100
        buf[off] = selectedSet.has(i) ? 100 : -100;
    }

    // Monta cabeçalho PLY ASCII
    const colDefs = available.map(p => `property float ${p}`).join('\n');
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${count}`,
        colDefs,
        'property float opacity_raw',
        'end_header'
    ].join('\n') + '\n';

    const headerBytes = new TextEncoder().encode(header);
    const dataBytes = new Uint8Array(buf.buffer);
    const out = new Uint8Array(headerBytes.length + dataBytes.length);
    out.set(headerBytes);
    out.set(dataBytes, headerBytes.length);
    return out;
}

// ---------------------------------------------------------------------------
// Classe do script
// ---------------------------------------------------------------------------
export class VrMaskerScript extends pc.Script {
    // Propriedades declaradas para o Editor PlayCanvas
    static scriptName = 'vrMasker';
}

VrMaskerScript.attributes.add('coneAngleDeg', { type: 'number', default: 30 });
VrMaskerScript.attributes.add('coneRange',    { type: 'number', default: 5 });
VrMaskerScript.attributes.add('bridgeUrl',    { type: 'string', default: BRIDGE_DEFAULT_URL });
VrMaskerScript.attributes.add('autoSendOnStop',{ type: 'boolean', default: true });

VrMaskerScript.prototype.initialize = function () {
    /** @type {pc.Entity|null} */
    this._splatEntity = null;
    /** @type {Set<number>} */
    this._selected = new Set();
    this._active = false;       // trigger pressionado
    this._tanAngle = Math.tan(this.coneAngleDeg * Math.PI / 180);

    // Botão de ativação desktop (Espaço)
    this._keyboard = this.app.keyboard;
    this._wasSpaceDown = false;

    // XR input sources
    this._xrSource = null;
    if (this.app.xr) {
        this.app.xr.input.on('add', (src) => {
            if (!this._xrSource) this._xrSource = src;
        });
        this.app.xr.input.on('remove', (src) => {
            if (this._xrSource === src) this._xrSource = null;
        });
    }
};

VrMaskerScript.prototype.setSplatEntity = function (entity) {
    this._splatEntity = entity;
};

VrMaskerScript.prototype.update = function (dt) {
    // Detecta trigger
    const spaceDown = this._keyboard?.isPressed(pc.KEY_SPACE) ?? false;
    const xrTrigger = this._xrSource?.getButton(0) ?? false;
    const triggerDown = spaceDown || xrTrigger;

    if (triggerDown && !this._active) {
        this._active = true;
    }

    if (triggerDown && this._active) {
        this._doSelection();
    }

    if (!triggerDown && this._active) {
        this._active = false;
        if (this.autoSendOnStop) {
            this._sendToBridge();
        }
    }
};

VrMaskerScript.prototype._getConeParams = function () {
    let apex, axis;

    if (this._xrSource) {
        apex = this._xrSource.getPosition();
        const rot = this._xrSource.getRotation();
        // eixo -Z local do controlador em world space
        axis = new pc.Vec3(0, 0, -1);
        const q = new pc.Quat(rot.x, rot.y, rot.z, rot.w);
        q.transformVector(axis, axis);
        axis.normalize();
    } else {
        // Fallback: câmera
        apex = this.entity.getPosition().clone();
        axis = new pc.Vec3();
        this.entity.getWorldTransform().getZ(axis);
        axis.scale(-1).normalize(); // -Z world = forward
    }

    return { apex, axis };
};

VrMaskerScript.prototype._doSelection = function () {
    if (!this._splatEntity) return;

    const gsplatComp = this._splatEntity.gsplat;
    if (!gsplatComp?.asset?.resource) return;

    const splatData = gsplatComp.asset.resource.splatData;
    if (!splatData) return;

    const { apex, axis } = this._getConeParams();
    const tanAngle = Math.tan(this.coneAngleDeg * Math.PI / 180);
    const maxRange = this.coneRange;

    // Matriz world do entity do splat para transformar pontos para world space
    const worldMat = this._splatEntity.getWorldTransform();
    const p = new pc.Vec3();
    const pw = new pc.Vec3();

    let changed = false;
    const count = splatData.numSplats;

    for (let i = 0; i < count; i++) {
        if (this._selected.has(i)) continue; // já selecionado

        p.set(
            splatData.getElement('vertex', 'x', i),
            splatData.getElement('vertex', 'y', i),
            splatData.getElement('vertex', 'z', i)
        );
        worldMat.transformPoint(p, pw);

        if (pointInsideCone(pw, apex, axis, tanAngle, maxRange)) {
            this._selected.add(i);
            changed = true;
        }
    }

    if (changed) {
        this.fire('selected:update', this._selected.size);
    }
};

VrMaskerScript.prototype._sendToBridge = function () {
    if (!this._splatEntity || this._selected.size === 0) {
        this.fire('bridge:error', 'Nenhum splat selecionado');
        return;
    }

    const gsplatComp = this._splatEntity.gsplat;
    if (!gsplatComp?.asset?.resource?.splatData) {
        this.fire('bridge:error', 'GSplat data indisponível');
        return;
    }

    const plyBytes = exportMaskedPly(
        gsplatComp.asset.resource.splatData,
        this._selected
    );

    fetch(this.bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: plyBytes
    })
    .then(async (res) => {
        const text = await res.text();
        if (!res.ok) throw new Error(text);
        const json = JSON.parse(text);
        this.fire('bridge:success', json);
    })
    .catch((err) => {
        this.fire('bridge:error', err.message ?? String(err));
    });
};

VrMaskerScript.prototype.clearSelection = function () {
    this._selected.clear();
    this.fire('selected:update', 0);
};
