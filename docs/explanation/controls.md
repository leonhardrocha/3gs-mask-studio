# `controls.mjs` — painel HTML (two-way binding)

**Arquivo:** `src/controls.mjs`
**Papel:** constrói o painel de controle em DOM puro e o conecta ao store
[[observer]] com binding bidirecional. Substitui os controles React + PCUI do
exemplo original.

Voltar ao índice: [[README]] · Estado: [[observer]] · Estilo: [[style]] ·
Chamado por: [[main]]

---

## Ideia geral

O painel **não** guarda estado próprio: ele lê/escreve no `data` ([[observer]]).
- Mudou um controle → `data.set(...)`.
- `data` mudou em outro lugar → o controle se atualiza via `data.on('<chave>:set', ...)`.

Isso garante que resets programáticos (ex. após um *commit* em [[edit-system]])
movam os sliders na tela.

---

## Helpers de DOM

### `el(tag, attrs, ...children)` (linhas 9–18)
Mini-fábrica de elementos. Trata `class` e `text` como casos especiais; o resto
vira atributo. Anexa filhos.

### `panel` / `row` (linhas 20–26)
- `panel(title, ...rows)` → `<section class="group">` com `<h2>` + linhas.
- `row(label, control)` → `<label class="row">` com rótulo + controle.

As classes CSS (`group`, `row`, `row-label`, `slider`…) estão em [[style]].

### Conversão de cor (linhas 28–33)
`hexToRgb` / `rgbToHex` convertem entre `#rrggbb` (input `type=color`) e o array
`[r,g,b]` normalizado (0–1) que o resto do app usa (ex. `selectionColor`).

### `slider(...)` (linhas 35–44)
Slider **one-way**: chama `onInput(v)` e atualiza o `<output>` numérico. Usado
quando não há necessidade de refletir mudanças externas (ex. `brushSize`,
`selectionStrength`).

### `boundSlider(data, key, ...)` (linhas 48–57) — o coração do binding
```js
input.oninput = () => data.set(key, Number(input.value));   // controle → estado
data.on(`${key}:set`, (v) => {                              // estado → controle
    input.value = String(v);
    out.textContent = Number(v).toFixed(2);
});
```
**Two-way**: escreve no `data` ao mover e se move quando o `data` muda. Por isso os
sliders de transformação voltam a zero quando [[edit-system]] reseta a operação.

---

## `buildControls(data)` — montagem dos painéis (linha 59+)

Cada painel cria controles e os conecta a uma chave do [[observer]]. Resumo dos
eventos/chaves disparados:

| Painel | Controle | Ação no `data` |
|---|---|---|
| Renderer | select | `set('renderer', n)`; reage a `renderer:set` |
| XR | botão "Entrar em VR" | `emit('enterVR')` → [[xr-session]] |
| XR | checkboxes / sliders | `xrRayVisible`, `xrRayDistance`, `xrMoveSpeed`, `xrSnapToSurface` |
| Seleção | modo / pincel | `selectionMode`, `brushSize` |
| Seleção | botões | `emit('clearSelection')`, `emit('invertSelection')` |
| Realce | cor / força | `selectionColor`, `selectionStrength` |
| Transformar | checkbox editar | `editing` (liga preview) |
| Transformar | sliders T/R/Escala | `editTx..Tz`, `editRx..Rz`, `editScale` |
| Transformar | recolorir | `editColorEnabled`, `editColor` |
| Transformar | botões | `emit('commitEdit')`, `emit('resetEdit')`, `emit('recomputePivot')` |
| Labels | controles | `labelViewerEnabled`, `labelBlend`, `labelColorMapMode`, `labelColorMapScheme` |
| Exportar | escopo + botão | `emit('exportPly', 'subset'\|'whole')` → [[ply-exporter]] |
| Carregar Asset | texto + botão | `emit('addAsset', url)` |
| Visibilidade | dinâmico | ver abaixo |

### Detalhes importantes

**Binding bidirecional em checkboxes** (linhas 99–111): `editing`, `editColorEnabled`
e `editColor` têm `data.on('<chave>:set', ...)` além do `onchange`, porque
[[edit-system]] pode alterá-los programaticamente (ex. `reset()` desliga
`editColorEnabled`).

**Lista de visibilidade dinâmica** (linhas 141–157):
```js
const renderVisibility = () => { /* recria checkboxes a partir de assetVisibilityItems */ };
data.on('assetVisibilityItems:set', renderVisibility);
```
[[selection-system]] popula `assetVisibilityItems` via `registerVisibilityItem`;
cada item cria um checkbox amarrado à chave `showAsset_<nome>`. Marcar/desmarcar
chama `data.set(item.path, bool)`, que [[selection-system]] escuta para mostrar/ocultar
a entidade.

**Montagem final**: `body.replaceChildren(...)` injeta todos os painéis no
`<div id="controls-body">` de uma vez.

## Atualizações (sessão atual)

Novos painéis/controles (todos via [[observer]], espelhando o [[mode-panel]]):

- **Histórico** — botões Desfazer/Refazer (habilitação reativa a `canUndo`/`canRedo`; [[history]]).
- **Seleção** — seletor **Objeto ativo** (`activeSelectionTarget`, populado de `assetVisibilityItems`).
- **XR** — slider **Precisão do snap** (`snapBeamRadius`; [[splat-index]]).
- **Retexturizar** — seletor de objeto (`retexObjects`/`retextureRunName`), **Adicionar objeto**,
  textura, **Aplicar retexturização** e **Status** reativo (`retextureStatus`; [[retexture]]).
