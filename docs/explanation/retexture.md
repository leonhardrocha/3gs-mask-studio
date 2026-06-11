# `src/retexture.mjs` — ferramenta de retextura

Substitui a região selecionada por uma versão **retexturizada** vinda de um serviço externo,
e adiciona objetos pré-treinados do catálogo do serviço.

> Usa [[ply-exporter]] (`buildRawSelectionPly`), [[selection-system]] (`hideSelected`) e
> [[edit-system]] (`reapplyEdits`). UI em [[mode-panel]] (modo Retexturizar) e [[controls]].

## Serviço + proxy

Serviço na **porta 5000**, na máquina do dev server:
- `POST /api/v1/retexture` (multipart: `run_name`, `file_selected`=.ply, `file_texture`=imagem)
  → JSON `{status, combined_ply_url, log_url}`.
- `GET /download_ply/{name}` — baixa um ply do catálogo (pode **redirecionar** para o arquivo
  final, ex.: `Fruits` → `40000.ply`).

Tudo passa pelo **proxy do Vite** (`/retex`), então o browser fala same-origin/HTTPS e o Vite
repassa ao serviço local — evita **mixed-content** (WebXR é HTTPS) e **CORS**. Duas regras:
`/retex/download_ply` (com `followRedirects`, GET sem corpo) e `/retex` (POST **sem**
`followRedirects` — o upload grande estouraria o limite de body da lib).

## Fluxo `applyRetexture`

1. **Exportar cru** — `buildRawSelectionPly` exporta a seleção em **coords originais/locais**
   (sem placement, sem edição, sem override; com SH), de **um** objeto (`multi:true` se cruzar
   objetos → avisa). Retorna `src` + `indices`.
2. **POST** ao serviço (textura de `retextureTextureUrl`).
3. **Baixar** `combined_ply_url` (reescrito para o proxy, com cache-bust); `loadGsplat` tem
   timeout de 60 s + logs.
4. **Reaplicar transformações** — `createSelectableSplat` no novo ply; copia o transform local
   da entidade de origem (`setLocalPosition/Rotation/Scale`) e, se a contagem bater 1:1,
   `editSystem.reapplyEdits(newObj, src, indices)` (mirror por-splat).
5. **`hideSelected()`** (stream `hidden`) + `clearSelection`.

> Exportar local e reaplicar via **entidade** faz o renderizador tratar os SH corretamente
> sob rotação — **sem Wigner-D**. Requer que o serviço **preserve contagem/ordem** dos splats
> (senão só o placement é reaplicado, com warning).

## Adicionar objeto (`addRetexObject`)

Baixa `/download_ply/{retextureRunName}` (catálogo `retexObjects`, hoje `['Fruits']`) e o
adiciona como objeto selecionável com **label = nome**. `retextureRunName` serve de `{name}`
no download **e** de `run_name` no POST.

## Estado (no [[observer]])

`retexObjects` (catálogo), `retextureRunName` (objeto/run selecionado), `retextureTextureUrl`/
`retextureTextureName`, `retextureStatus` (progresso mostrado no painel).
