import * as pc from 'playcanvas';

import { buildRawSelectionPly } from './export/ply-exporter.mjs';

/**
 * Retexture tool — sends the selected region to an external service and replaces
 * it with the returned, retextured mesh.
 *
 * Flow (triggered by the `applyRetexture` event):
 *   1. Export the SELECTION as a world-space binary PLY (subset).
 *   2. POST it + a texture image (multipart/form-data) to the service.
 *   3. Read `combined_ply_url` from the JSON response, download the result.
 *   4. Add it as a new selectable splat and HIDE the original selected splats.
 *
 * Networking goes through the Vite `/retex` proxy → the service on the dev-server
 * machine (`:5000`). This keeps every browser request same-origin/HTTPS, so it
 * works from the headset (WebXR is HTTPS; a direct http://…:5000 call would be
 * blocked as mixed content) and avoids CORS. The absolute `combined_ply_url`
 * returned by the service is rewritten onto the same proxy path.
 */

const PROXY = '/retex';

export function createRetexture({ app, system, editSystem, data }) {
    let busy = false;
    const setStatus = (s) => data.set('retextureStatus', s);

    const loadGsplat = (url, name, filename = 'result.ply') => new Promise((resolve, reject) => {
        console.log('[retexture] carregando PLY:', url);
        const asset = new pc.Asset(name, 'gsplat', { url, filename });
        let settled = false;
        const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); fn(arg); };
        const timer = setTimeout(() => finish(reject, new Error('timeout (60s) — sem resposta do serviço')), 60000);
        asset.ready(() => { console.log('[retexture] PLY pronto:', name, asset.resource?.numSplats ?? '?', 'splats'); finish(resolve, asset); });
        asset.once('error', (err) => { console.warn('[retexture] erro no PLY:', url, err); finish(reject, new Error(`download/parse falhou: ${err}`)); });
        app.assets.add(asset);
        app.assets.load(asset);
    });

    // Add a pre-trained / retexturizable object from the service catalog.
    // Downloads /download_ply/{name} (name = retextureRunName, e.g. "Fruits") and
    // adds it as a new selectable splat labelled with that name.
    const addObject = async () => {
        if (busy) return;
        busy = true;
        try {
            const objName = data.get('retextureRunName') || 'Fruits';
            setStatus(`baixando ${objName}…`);
            const url = `${PROXY}/download_ply/${encodeURIComponent(objName)}?t=${Date.now()}`;
            const name = `obj-${objName}-${Date.now()}`;
            const asset = await loadGsplat(url, name, `${objName}.ply`);
            system.createSelectableSplat(name, asset, [0, -0.5, -1.5], [180, 0, 0], [1, 1, 1]);
            system.registerVisibilityItem(name, objName); // label = object name ("Fruits")
            system.syncAssetVisibility();
            setStatus(`adicionado: ${objName}`);
        } catch (err) {
            console.error('[retexture] adicionar objeto falhou:', err);
            setStatus(`erro: ${err?.message ?? err}`);
        } finally {
            busy = false;
        }
    };

    const run = async () => {
        if (busy) return;
        busy = true;
        try {
            // Export the selection in ORIGINAL/local coords (no placement, no edits)
            // so the service sees geometry identical to the source PLY.
            setStatus('exportando seleção (coords originais)…');
            const raw = await buildRawSelectionPly({ system });
            if (raw.multi) { setStatus('selecione apenas UM objeto'); return; }
            if (!raw.count || !raw.blob) { setStatus('nada selecionado'); return; }
            const { src, indices } = raw;

            setStatus('carregando textura…');
            const texUrl = data.get('retextureTextureUrl');
            const texResp = await fetch(texUrl);
            if (!texResp.ok) throw new Error(`textura indisponível (${texResp.status})`);
            const texBlob = await texResp.blob();
            const texName = (texUrl.split('/').pop() || 'textura.png').split('?')[0];

            setStatus('enviando ao serviço…');
            const fd = new FormData();
            fd.append('run_name', data.get('retextureRunName') || 'EXPERIMENTO_01');
            fd.append('file_selected', raw.blob, 'splats_selected.ply');
            fd.append('file_texture', texBlob, texName);
            const resp = await fetch(`${PROXY}/api/v1/retexture`, { method: 'POST', body: fd });
            if (!resp.ok) throw new Error(`serviço respondeu ${resp.status}`);
            const json = await resp.json();
            if (json.status !== 'success') throw new Error(json.message || 'serviço retornou erro');

            setStatus('baixando resultado…');
            // Rewrite the absolute service URL onto the proxy path (+ cache-bust).
            const resultPath = new URL(json.combined_ply_url, location.origin).pathname;
            const proxied = `${PROXY}${resultPath}?t=${Date.now()}`;
            const name = `retex-${Date.now()}`;
            const asset = await loadGsplat(proxied, name, 'combined.ply');

            // Re-apply the source object's transform: place the new object with the
            // SAME entity placement (the engine then renders its SH correctly under
            // that rotation), and copy the per-splat committed edits (1:1 by index).
            setStatus('reaplicando transformações…');
            system.createSelectableSplat(name, asset, [0, 0, 0], [0, 0, 0], [1, 1, 1]);
            const newObj = system.selectables.find(x => x.entity.name === name);
            if (newObj) {
                newObj.entity.setLocalPosition(src.entity.getLocalPosition());
                newObj.entity.setLocalRotation(src.entity.getLocalRotation());
                newObj.entity.setLocalScale(src.entity.getLocalScale());
                if (newObj.numSplats === indices.length) {
                    editSystem.reapplyEdits(newObj, src, indices);
                } else {
                    console.warn(`[retexture] o serviço mudou a contagem (${newObj.numSplats} vs ${indices.length} enviados); ` +
                        'edições por-splat não reaplicadas (placement do objeto preservado).');
                }
            }
            system.registerVisibilityItem(name, 'Retextura');
            system.syncAssetVisibility();

            await system.hideSelected();      // hide the region we just replaced
            data.emit('clearSelection');
            setStatus(`concluído (${raw.count} splats)`);
        } catch (err) {
            console.error('[retexture] falhou:', err);
            setStatus(`erro: ${err?.message ?? err}`);
        } finally {
            busy = false;
        }
    };

    data.on('applyRetexture', run);
    data.on('addRetexObject', addObject);
    return { run, addObject, get busy() { return busy; } };
}
