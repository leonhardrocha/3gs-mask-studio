# `selection/brush-input.mjs` — input desktop (mouse + Picker)

**Arquivo:** `src/selection/brush-input.mjs`
**Papel:** input **desktop** de seleção. Botão direito do mouse seleciona com
*snap* na superfície do splat (via `pc.Picker`); esquerdo/roda continuam orbitando.

Voltar ao índice: [[README]] · Criado por: [[main]] ·
Enfileira em: [[selection-system]] · Estado: [[observer]]
Pré-requisito de baixo nível: [[concepts]] §2 (passes de GPU / por que o `Picker`
é um passe à parte)

---

## Visão geral

- **Botão direito** = pincel de seleção (segurar = arrastar pincel).
- **Snap na superfície**: usa o *depth* do `pc.Picker` para achar o ponto 3D sob o
  cursor na superfície do splat. O pincel (esfera) é enfileirado nesse ponto.
- **Modo**: `data.selectionMode` (`additive`/`subtractive`); segurar **Shift** inverte.
- **Esquerdo / roda / meio**: orbitam nativamente (script `orbit-camera`).

> **WebGL-only**: `getWorldPointAsync` só funciona em WebGL — por isso o app usa
> WebGL2 por padrão ([[config]]). No WebGPU este caminho fica desativado.

---

## Passo a passo

### 1. Picker + camada World (linhas 20–21)
```js
const picker = new pc.Picker(app, 1, 1, true);            // 3º arg = depth picking ON
const worldLayer = app.scene.layers.getLayerByName('World');
```
O `true` habilita *depth picking*, requisito do `getWorldPointAsync`.

### 2. `preparePicker` (linhas 28–34)
Redimensiona o picker ao tamanho do canvas e chama `picker.prepare(camera, scene,
[worldLayer])` — renderiza a camada World do ponto de vista da câmera principal para
o buffer do picker. Só refaz quando `pickerDirty` (marcado no mouse-down).

### 3. `modeFrom(e)` (linhas 36–40)
```js
const subtractive = data.get('selectionMode') === 'subtractive';
const flip = !!e.shiftKey;
return (subtractive !== flip) ? SELECT_SUBTRACTIVE : SELECT_ADDITIVE;
```
XOR lógico: Shift inverte o modo atual. Constantes vêm de [[selection-system]].

### 4. `selectAt(x, y, mode)` (linhas 42–49)
```js
preparePicker();
picker.getWorldPointAsync(x, y).then((worldPoint) => {
    if (worldPoint) system.queueSelect(worldPoint, data.get('brushSize'), mode);
});
```
Converte coordenadas de tela → ponto-mundo e **enfileira** a seleção em
[[selection-system]] (consumida no `update` por `processPending`).

Comportamento de `getWorldPointAsync` (engine, `framework/graphics/picker.js`):
```js
// Pick world position (requires depth enabled)
picker.getWorldPointAsync(x, y).then((worldPoint) => {
    if (worldPoint) { console.log(worldPoint); }
});
```
Retorna `null` quando não há geometria sob o cursor (daí o `if (worldPoint)`).

### 5. Handlers de mouse (linhas 51–79)
- **`onMouseDown`** (botão direito): ativa `isSelecting`, marca `pickerDirty`,
  **desabilita o orbit** (`orbitInput.enabled = false` e cancela o pan que o
  orbit-camera iniciou) e seleciona no ponto.
- **`onMouseMove`**: se `isSelecting`, continua selecionando (arrasto do pincel).
- **`stop` / `onMouseUp`**: encerra a seleção e **reabilita o orbit**. Também há um
  `mouseup` global (`window`) para o caso de soltar o botão fora do canvas.

`app.mouse.disableContextMenu()` (linha 26) impede o menu de contexto no botão direito.

### 6. `destroy` / `markPickerDirty` (linhas 81–92)
`destroy` remove todos os listeners e destrói o picker (chamado no cleanup de
[[main]]). `markPickerDirty` permite forçar um novo `prepare` (ex. se a câmera mudou).

---

## Relação com o XR
O equivalente para VR é [[xr-session]], que posiciona o pincel por **raio do
controle** (distância fixa ajustável) em vez de *snap* por picker — porque o `Picker`
se mostrou instável dentro da sessão XR (ver `ARCHITECTURE.md` §10).
