/**
 * serialize-selected-full.mjs
 *
 * Exporta a seleção atual usando a API oficial do SuperSplat (`scene.write`),
 * preservando todas as propriedades suportadas pelo serializador de PLY.
 *
 * Uso esperado:
 *   - seleção visual continua sendo feita por `inject.mjs`
 *   - envio ao bridge pode usar este módulo para gerar um PLY completo
 *   - fluxo novo: exportar PLY completo, sobrescrever opacidade pela seleção
 *     atual e aplicar filtro via CLI no bridge
 */

class InMemoryWritableFileStream {
    constructor() {
        this._chunks = [];
        this._cursor = 0;
        this._truncatedSize = null;
    }

    async seek(position) {
        this._cursor = Number(position) || 0;
    }

    async write(data) {
        let bytes;
        if (data instanceof Uint8Array) {
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else {
            throw new Error('Unsupported stream write payload for PLY export.');
        }

        // BrowserFileWriter escreve sequencialmente; copiamos o chunk para evitar aliasing.
        this._chunks.push(bytes.slice());
        this._cursor += bytes.byteLength;
    }

    async truncate(size) {
        this._truncatedSize = Number.isFinite(size) ? Math.max(0, size) : null;
    }

    async close() {
        // no-op: buffer já está em memória
    }

    toUint8Array() {
        let total = 0;
        for (const c of this._chunks) total += c.byteLength;

        let out = new Uint8Array(total);
        let offset = 0;
        for (const c of this._chunks) {
            out.set(c, offset);
            offset += c.byteLength;
        }

        if (this._truncatedSize !== null && this._truncatedSize < out.byteLength) {
            out = out.slice(0, this._truncatedSize);
        }
        return out;
    }
}

function getPrimarySplat() {
    const scene = window.scene;
    const splats = scene?.elements?.filter(e => e?.splatData) ?? [];
    return splats[0] ?? null;
}

function countSelected(stateArr, n) {
    if (!stateArr) return n;
    let selected = 0;
    for (let i = 0; i < n; i++) {
        if ((stateArr[i] & 1) !== 0) selected++;
    }
    return selected;
}

function withSelectionOpacityMask(splat, selectedOpacityRaw, unselectedOpacityRaw, fn) {
    const opacity = splat?.splatData?.getProp?.('opacity');
    const stateArr = splat?.splatData?.getProp?.('state');

    if (!opacity || !stateArr) {
        throw new Error('Splat sem propriedades opacity/state para aplicar máscara.');
    }

    const backup = opacity.slice();
    try {
        for (let i = 0; i < opacity.length; i++) {
            const isSelected = (stateArr[i] & 1) !== 0;
            opacity[i] = isSelected ? selectedOpacityRaw : unselectedOpacityRaw;
        }
        return fn();
    } finally {
        opacity.set(backup);
        if (typeof splat.updateState === 'function') {
            splat.updateState();
        }
        if (window.scene) {
            window.scene.forceRender = true;
        }
    }
}

export async function serializeSelectedPlyFull({
    filename = 'selected-full.ply',
    maxSHBands = 3,
    keepStateData = false
} = {}) {
    const scene = window.scene;
    const events = scene?.events;
    if (!scene || !events || typeof events.invoke !== 'function') {
        return { error: 'API scene.events.invoke indisponível no SuperSplat atual.' };
    }

    const splat = getPrimarySplat();
    if (!splat?.splatData) {
        return { error: 'Nenhum splat carregado.' };
    }

    const stateArr = splat.splatData.getProp('state');
    const selectedCount = countSelected(stateArr, splat.splatData.numSplats);
    if (selectedCount <= 0) {
        return { error: 'Nenhuma gaussiana selecionada.' };
    }

    const stream = new InMemoryWritableFileStream();

    const options = {
        filename,
        splatIdx: 'all',
        serializeSettings: {
            selected: true,
            maxSHBands,
            keepStateData
        }
    };

    await events.invoke('scene.write', 'ply', options, stream);

    const bytes = stream.toUint8Array();
    if (!bytes.byteLength) {
        return { error: 'Falha ao exportar PLY via scene.write (buffer vazio).' };
    }

    return {
        ok: true,
        count: selectedCount,
        buffer: bytes.buffer
    };
}

export async function serializeFullPlyWithSelectionOpacity({
    filename = 'selection-opacity-tagged.ply',
    maxSHBands = 3,
    keepStateData = false,
    selectedOpacityRaw = 0.0,
    unselectedOpacityRaw = 1.0
} = {}) {
    const scene = window.scene;
    const events = scene?.events;
    if (!scene || !events || typeof events.invoke !== 'function') {
        return { error: 'API scene.events.invoke indisponível no SuperSplat atual.' };
    }

    const splat = getPrimarySplat();
    if (!splat?.splatData) {
        return { error: 'Nenhum splat carregado.' };
    }

    const stateArr = splat.splatData.getProp('state');
    const selectedCount = countSelected(stateArr, splat.splatData.numSplats);
    if (selectedCount <= 0) {
        return { error: 'Nenhuma gaussiana selecionada.' };
    }

    const stream = new InMemoryWritableFileStream();

    const options = {
        filename,
        splatIdx: 'all',
        serializeSettings: {
            selected: false,
            maxSHBands,
            keepStateData
        }
    };

    await withSelectionOpacityMask(
        splat,
        selectedOpacityRaw,
        unselectedOpacityRaw,
        async () => {
            await events.invoke('scene.write', 'ply', options, stream);
        }
    );

    const bytes = stream.toUint8Array();
    if (!bytes.byteLength) {
        return { error: 'Falha ao exportar PLY completo com máscara de opacidade.' };
    }

    return {
        ok: true,
        count: selectedCount,
        buffer: bytes.buffer
    };
}

export async function sendSelectedPlyFullToBridge({
    bridgeUrl,
    filename = 'selected-full.ply',
    maxSHBands = 3,
    keepStateData = false
} = {}) {
    if (!bridgeUrl) {
        return { error: 'bridgeUrl é obrigatório.' };
    }

    const serialized = await serializeSelectedPlyFull({ filename, maxSHBands, keepStateData });
    if (!serialized?.ok) {
        return serialized ?? { error: 'Falha desconhecida ao serializar seleção.' };
    }

    const resp = await fetch(bridgeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'x-input-filename': filename
        },
        body: serialized.buffer
    });

    const json = await resp.json();
    if (!resp.ok || !json?.ok) {
        return {
            error: json?.error || `Bridge returned ${resp.status}`,
            details: json
        };
    }

    return {
        ok: true,
        count: serialized.count,
        outputBytes: json.outputBytes,
        outputPath: json.outputPath,
        response: json
    };
}

export async function sendOpacityFilteredPlyToBridge({
    bridgeUrl,
    filename = 'selection-opacity-tagged.ply',
    maxSHBands = 3,
    keepStateData = false,
    selectedOpacityRaw = 0.0,
    unselectedOpacityRaw = 1.0,
    opacityThresholdRaw = 0.0,
    cliPath = '../../splat-transform/bin/cli.mjs'
} = {}) {
    if (!bridgeUrl) {
        return { error: 'bridgeUrl é obrigatório.' };
    }

    const serialized = await serializeFullPlyWithSelectionOpacity({
        filename,
        maxSHBands,
        keepStateData,
        selectedOpacityRaw,
        unselectedOpacityRaw
    });
    if (!serialized?.ok) {
        return serialized ?? { error: 'Falha ao preparar PLY completo com máscara de opacidade.' };
    }

    const selectCmd = `node ${cliPath} -w {input} {selected}`;
    const maskCmd = `node ${cliPath} -w {selected} -V opacity_raw,gt,${Number(opacityThresholdRaw)} {masked}`;
    const exportCmd = `node ${cliPath} -w {masked} {output}`;

    const resp = await fetch(bridgeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'x-input-filename': filename,
            'x-select-cli-cmd': selectCmd,
            'x-mask-cli-cmd': maskCmd,
            'x-export-cli-cmd': exportCmd
        },
        body: serialized.buffer
    });

    const json = await resp.json();
    if (!resp.ok || !json?.ok) {
        return {
            error: json?.error || `Bridge returned ${resp.status}`,
            details: json
        };
    }

    return {
        ok: true,
        count: serialized.count,
        outputBytes: json.outputBytes,
        outputPath: json.outputPath,
        response: json
    };
}
