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

import * as pc from '../../engine/build/playcanvas.mjs';
import { INPUT_MODE, PointerInputAdapter } from './input-pointer.mjs';

export const BRIDGE_DEFAULT_URL = 'http://localhost:3001/process-mask';

const CONE_SHADER_VERT_URL = new URL('./cone-shader.vert.glsl', import.meta.url).href;
const CONE_SHADER_FRAG_URL = new URL('./cone-shader.frag.glsl', import.meta.url).href;
const SELECTION_WORKER_URL = new URL('./selection-worker.mjs', import.meta.url);

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
    // Colunas float32 disponíveis no GSplatData (getProp retorna Float32Array ou null)
    const available = props.filter(p => splatData.getProp(p) != null);
    const propArrays = available.map(p => splatData.getProp(p));

    const stride = available.length + 1; // +1 para opacity_raw
    const buf = new Float32Array(count * stride);

    for (let i = 0; i < count; i++) {
        let off = i * stride;
        for (let j = 0; j < propArrays.length; j++) {
            buf[off++] = propArrays[j][i];
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
VrMaskerScript.attributes.add('selectionChunkSize', { type: 'number', default: 20000 });
VrMaskerScript.attributes.add('useSelectionWorker', { type: 'boolean', default: false });
VrMaskerScript.attributes.add('inputMode', { type: 'string', default: INPUT_MODE.AUTO });

VrMaskerScript.prototype.initialize = function () {
    /** @type {pc.Entity|null} */
    this._splatEntity = null;
    /** @type {Set<number>} */
    this._selected = new Set();
    this._active = false;       // trigger pressionado
    this._tanAngle = Math.tan(this.coneAngleDeg * Math.PI / 180);
    this._scanCursor = 0;
    this._scanRequestId = 0;

    this._selectionWorker = null;
    this._workerReady = false;
    this._workerPending = false;
    this._workerOps = new Map();

    // Camada unificada de entrada (mouse + XR + fallback teclado)
    this._pointer = new PointerInputAdapter(this.entity, this.app, this.inputMode);

    // Helper visual do cone (runtime). Em fase futura, o mesh virá do Editor.
    this._coneRoot = null;
    this._coneVisual = null;
    this._coneMaterial = null;
    this._coneColor = new pc.Color(0.2, 0.8, 1.0, 0.22);
    this._initConeHelper();
    this._initSelectionWorker();
};

VrMaskerScript.prototype.setSplatEntity = function (entity) {
    this._splatEntity = entity;
    this._scanCursor = 0;

    if (this._selectionWorker) {
        this._prepareWorkerPositions();
    }
};

VrMaskerScript.prototype.update = function (dt) {
    this._pointer.setMode(this.inputMode);
    this._pointer.update(dt);

    const triggerDown = this._pointer.isSelectPressed();
    const rangeDelta = this._pointer.consumeRangeDelta(0.1);
    if (rangeDelta !== 0) {
        this.coneRange = pc.math.clamp(this.coneRange + rangeDelta, 0.1, 50);
    }

    if (triggerDown && !this._active) {
        this._active = true;
        this._scanCursor = 0;

        if (this._pointer.getOperation() === 'set' && this._selected.size) {
            this._selected.clear();
            this.fire('selected:update', 0);
        }
    }

    if (triggerDown && this._active) {
        this._doSelection();
    }

    if (!triggerDown && this._active) {
        this._active = false;
        this._pointer.pulseFeedback(0.25, 40).catch(() => {});
        if (this.autoSendOnStop) {
            this._sendToBridge();
        }
    }

    this._syncConeHelper(triggerDown);
    this.fire('input:update', this.getInputDebugState());
};

VrMaskerScript.prototype._initConeHelper = async function () {
    // Prioriza cone criado como asset de cena (ex.: via PlayCanvas Editor).
    // Convencao: entidade com nome "ConeHelper" e componente render.
    const sceneCone = this.app.root.findByName('ConeHelper');
    if (sceneCone?.render) {
        this._coneRoot = sceneCone;
        this._coneVisual = sceneCone;
    } else {
        this._coneRoot = new pc.Entity('ConeHelperRoot');
        this._coneVisual = new pc.Entity('ConeHelperVisual');
        this._coneVisual.addComponent('render', { type: 'cone' });
        this._coneVisual.setLocalEulerAngles(90, 0, 0);
        this._coneRoot.addChild(this._coneVisual);
        this.app.root.addChild(this._coneRoot);
    }

    this._coneRoot.enabled = false;

    try {
        const [vert, frag] = await Promise.all([
            fetch(CONE_SHADER_VERT_URL).then(r => r.text()),
            fetch(CONE_SHADER_FRAG_URL).then(r => r.text())
        ]);

        const mat = new pc.ShaderMaterial({
            uniqueName: 'VrMaskerConeShader',
            vertexGLSL: vert,
            fragmentGLSL: frag,
            attributes: {
                aPosition: pc.SEMANTIC_POSITION
            }
        });

        mat.blendType = pc.BLEND_NORMAL;
        mat.depthWrite = false;
        mat.cull = pc.CULLFACE_NONE;
        mat.setParameter('uConeRange', this.coneRange);
        mat.setParameter('uConeAngleTan', Math.tan(this.coneAngleDeg * Math.PI / 180));
        mat.setParameter('uConeColor', [this._coneColor.r, this._coneColor.g, this._coneColor.b, this._coneColor.a]);

        const meshInstances = this._coneVisual.render?.meshInstances ?? [];
        for (const mi of meshInstances) {
            mi.material = mat;
        }
        this._coneMaterial = mat;
    } catch (err) {
        // Fallback visual para manter feedback mesmo se shader custom falhar.
        const fallback = new pc.StandardMaterial();
        fallback.diffuse = new pc.Color(this._coneColor.r, this._coneColor.g, this._coneColor.b);
        fallback.opacity = this._coneColor.a;
        fallback.blendType = pc.BLEND_NORMAL;
        fallback.depthWrite = false;
        fallback.cull = pc.CULLFACE_NONE;
        fallback.update();
        const meshInstances = this._coneVisual.render?.meshInstances ?? [];
        for (const mi of meshInstances) {
            mi.material = fallback;
        }
    }
};

VrMaskerScript.prototype._syncConeHelper = function (isTriggerDown) {
    if (!this._coneRoot || !this._coneVisual) return;

    // Show cone when trigger is down OR when a gamepad/XR source is active (aim preview).
    const sourceType = this._pointer?.getSourceType?.() ?? 'fallback';
    const hasActiveInput =
        isTriggerDown ||
        sourceType === 'gamepad' ||
        sourceType === 'xr' ||
        sourceType === 'xr-left' ||
        sourceType === 'xr-right';
    this._coneRoot.enabled = hasActiveInput;
    if (!hasActiveInput) return;

    const pose = this._pointer.getPose();
    if (!pose?.origin || !pose?.direction) return;

    this._coneRoot.setPosition(pose.origin);

    const worldTarget = pose.origin.clone().add(pose.direction);
    const up = new pc.Vec3(0, 1, 0);
    this._coneRoot.lookAt(worldTarget, up);

    if (this._coneMaterial) {
        this._coneMaterial.setParameter('uConeRange', this.coneRange);
        this._coneMaterial.setParameter('uConeAngleTan', Math.tan(this.coneAngleDeg * Math.PI / 180));
        const c = this._getOperationColor();
        // Use reduced alpha for aim-preview (no trigger), full alpha when selecting.
        const alpha = isTriggerDown ? c.a : c.a * 0.4;
        this._coneMaterial.setParameter('uConeColor', [c.r, c.g, c.b, alpha]);
    }
};

VrMaskerScript.prototype._getOperationColor = function () {
    const op = this._pointer?.getOperation?.() || 'set';
    if (op === 'add') return new pc.Color(0.22, 0.9, 0.32, 0.24);
    if (op === 'remove') return new pc.Color(0.95, 0.22, 0.22, 0.24);
    return new pc.Color(0.2, 0.8, 1.0, 0.22);
};

VrMaskerScript.prototype.getInputDebugState = function () {
    const cursor = this._pointer?.getVirtualCursorPosition?.() || { x: 0, y: 0, active: false };
    return {
        sourceType: this._pointer?.getSourceType?.() || 'keyboard-fallback',
        operation: this._pointer?.getOperation?.() || 'set',
        coneRange: this.coneRange,
        coneAngleDeg: this.coneAngleDeg,
        selectedCount: this._selected.size,
        cursorX: cursor.x,
        cursorY: cursor.y,
        cursorActive: Boolean(cursor.active)
    };
};

VrMaskerScript.prototype._getConeParams = function () {
    const pose = this._pointer.getPose();
    return {
        apex: pose.origin,
        axis: pose.direction
    };
};

VrMaskerScript.prototype._initSelectionWorker = function () {
    if (!this.useSelectionWorker || typeof Worker === 'undefined') {
        return;
    }

    try {
        this._selectionWorker = new Worker(SELECTION_WORKER_URL, { type: 'module' });
        this._selectionWorker.onmessage = (ev) => {
            const msg = ev.data;
            if (msg.type === 'positions:ready') {
                this._workerReady = true;
                return;
            }

            if (msg.type === 'selected') {
                this._workerPending = false;
                const op = this._workerOps.get(msg.requestId) || 'set';
                this._workerOps.delete(msg.requestId);
                const arr = msg.indices instanceof Uint32Array ? msg.indices : new Uint32Array(msg.indices || []);
                let changed = false;
                for (let i = 0; i < arr.length; i++) {
                    const idx = arr[i];
                    if (op === 'remove') {
                        if (this._selected.delete(idx)) {
                            changed = true;
                        }
                    } else if (!this._selected.has(idx)) {
                        this._selected.add(idx);
                        changed = true;
                    }
                }
                if (changed) {
                    this.fire('selected:update', this._selected.size);
                }
            }
        };
    } catch (err) {
        this._selectionWorker = null;
        this._workerReady = false;
    }
};

VrMaskerScript.prototype._prepareWorkerPositions = function () {
    if (!this._selectionWorker || !this._splatEntity?.gsplat?.asset?.resource) {
        return;
    }

    const splatData = this._splatEntity.gsplat.asset.resource;
    const count = splatData.numSplats;
    const worldMat = this._splatEntity.getWorldTransform();

    const xProp = splatData.getProp('x');
    const yProp = splatData.getProp('y');
    const zProp = splatData.getProp('z');
    const local = new pc.Vec3();
    const world = new pc.Vec3();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        local.set(
            xProp[i],
            yProp[i],
            zProp[i]
        );
        worldMat.transformPoint(local, world);
        const base = i * 3;
        positions[base] = world.x;
        positions[base + 1] = world.y;
        positions[base + 2] = world.z;
    }

    this._workerReady = false;
    this._selectionWorker.postMessage({ type: 'setPositions', positions }, [positions.buffer]);
};

VrMaskerScript.prototype._doSelection = function () {
    if (!this._splatEntity) return;

    const gsplatComp = this._splatEntity.gsplat;
    if (!gsplatComp?.asset?.resource) return;

    const splatData = gsplatComp.asset.resource;

    const { apex, axis } = this._getConeParams();
    const tanAngle = Math.tan(this.coneAngleDeg * Math.PI / 180);
    const maxRange = this.coneRange;
    const operation = this._pointer.getOperation();

    let changed = false;
    const count = splatData.numSplats;
    const chunkSize = Math.max(1, Math.floor(this.selectionChunkSize || 1));
    const start = this._scanCursor;
    const end = Math.min(start + chunkSize, count);

    if (this._selectionWorker && this._workerReady && !this._workerPending) {
        this._workerPending = true;
        this._scanRequestId += 1;
        this._workerOps.set(this._scanRequestId, operation);
        this._selectionWorker.postMessage({
            type: 'selectChunk',
            requestId: this._scanRequestId,
            start,
            end,
            apex: { x: apex.x, y: apex.y, z: apex.z },
            axis: { x: axis.x, y: axis.y, z: axis.z },
            tanAngle,
            maxRange
        });

        this._scanCursor = end >= count ? 0 : end;
        return;
    }

    // Fallback: seleção no thread principal
    const worldMat = this._splatEntity.getWorldTransform();
    const xArr = splatData.getProp('x');
    const yArr = splatData.getProp('y');
    const zArr = splatData.getProp('z');
    const p = new pc.Vec3();
    const pw = new pc.Vec3();

    for (let i = start; i < end; i++) {
        if (operation === 'remove') {
            if (!this._selected.has(i)) continue;
        } else if (this._selected.has(i)) {
            continue;
        }

        p.set(xArr[i], yArr[i], zArr[i]);
        worldMat.transformPoint(p, pw);

        if (pointInsideCone(pw, apex, axis, tanAngle, maxRange)) {
            if (operation === 'remove') {
                if (this._selected.delete(i)) {
                    changed = true;
                }
            } else if (!this._selected.has(i)) {
                this._selected.add(i);
                changed = true;
            }
        }
    }

    this._scanCursor = end >= count ? 0 : end;

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
    if (!gsplatComp?.asset?.resource) {
        this.fire('bridge:error', 'GSplat data indisponível');
        return;
    }

    const plyBytes = exportMaskedPly(
        gsplatComp.asset.resource,
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

VrMaskerScript.prototype.destroy = function () {
    if (this._pointer) {
        this._pointer.destroy();
        this._pointer = null;
    }

    if (this._selectionWorker) {
        this._selectionWorker.terminate();
        this._selectionWorker = null;
        this._workerReady = false;
        this._workerPending = false;
    }

    this._workerOps.clear();
};
