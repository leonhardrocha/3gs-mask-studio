# `main.mjs` — orquestrador / ponto de entrada

**Arquivo:** `src/main.mjs`
**Papel:** ponto de entrada (`type=module`). Cria o device/app PlayCanvas (com XR),
carrega assets, monta a câmera + *rig*, instancia todos os sistemas e faz o
**wiring** dos eventos do [[observer]] para os sistemas.

Voltar ao índice: [[README]]
Importa: [[observer]] · [[config]] · [[controls]] · [[selection-system]] ·
[[brush-input]] · [[edit-system]] · [[ply-exporter]] · [[xr-session]]

---

## Passo a passo

### 1. `window.pc = pc` (linha 14)
```js
window.pc = pc;
```
Expõe a engine globalmente. O script clássico `orbit-camera.js` (carregado como
asset `script`) chama `pc.createScript(...)` e espera um `pc` global.

### 2. Canvas + device gráfico (linhas 16–26)
```js
const device = await pc.createGraphicsDevice(canvas, gfxOptions);
```
- `gfxOptions.deviceTypes = [deviceType]` — vem de [[config]] (WebGL2 por padrão).
- `antialias: false` — *gaussian splats* não se beneficiam de MSAA.
- `xrCompatible: true` — necessário para WebXR.
- `maxPixelRatio` limitado a 2 (custo de fragmentos no VR/retina).

### 3. `AppOptions` — sistemas e handlers (linhas 28–45)
```js
createOptions.componentSystems = [ ... GSplatComponentSystem ];
createOptions.resourceHandlers = [ ... GSplatHandler ];
createOptions.xr = pc.XrManager;
```
Registra **explicitamente** só os sistemas usados (Render, Camera, Light, Script,
**GSplat**) e os handlers de recursos (Texture, Container, **Script**, **GSplat**).
Diferente do `pc.Application` "tudo incluso", aqui usamos `AppBase` + `init` para
um app enxuto. `xr = pc.XrManager` habilita VR (ver [[xr-session]]).

### 4. Fill mode + resize (linhas 47–52)
Canvas preenche a janela (`FILLMODE_FILL_WINDOW`, `RESOLUTION_AUTO`). Listener de
`resize` removido no `destroy` (sem vazamento).

### 5. Estado padrão (linhas 54–78)
Inicializa **todas as chaves do [[observer]]** com seus defaults: `brushSize`,
`selectionMode`, `selectionColor/Strength`, chaves de `label*`, a op de edição
(`editing`, `editTx..`, `editScale`, `editColor`...) e as de XR (`xrRayVisible`,
`xrRayDistance`, `xrMoveSpeed`, `xrSnapToSurface`). Esses defaults precisam existir
**antes** de `buildControls`, pois o painel lê `data.get(...)` para o valor inicial.

### 6. `buildControls(data)` (linha 80)
Constrói o painel — ver [[controls]].

### 7. Assets (linhas 82–89)
Declara 4 assets (1 script `orbit-camera` + 3 `gsplat`) com URLs montadas via
`rootPath` ([[config]]). Carrega tudo com `pc.AssetListLoader`.

### 8. Callback de carga (linhas 90–215) — o app "ganha vida"

Depois que todos os assets carregam:

**a) Seletor de renderer** (linhas 94–101): liga a chave `renderer` a
`app.scene.gsplat.renderer`. Se o renderer pedido ("Auto") resolve para outro
concreto, devolve esse valor à UI (via `setTimeout` para não recursar dentro do
listener).

**b) Sistema de seleção** (linhas 104–114): cria o [[selection-system]] e adiciona
os splats selecionáveis (`createSelectableSplat`) com posição/rotação/escala fixas,
registrando cada um na lista de visibilidade. `syncAssetVisibility()` aplica o
estado inicial.

**c) Câmera + rig** (linhas 116–141):
```js
const cameraParent = new pc.Entity('CameraParent');   // o "rig"
...
cameraParent.addChild(camera);
```
> **Por quê um rig?** Em XR a engine escreve a pose do HMD na transformação **local**
> da câmera. Para mover o mundo sem brigar com isso, toda locomoção move o **rig**
> (`cameraParent`), nunca a câmera. Ver [[locomotion]] e a `ARCHITECTURE.md` §8.

A câmera recebe o script `orbitCamera` (do asset clássico) e os inputs de mouse.

**d) Sistema de edição** (linha 144): cria o [[edit-system]].

**e) Input de brush desktop** (linha 147): cria o [[brush-input]] (passa a
`camera` e o `orbitInput` para poder desativar o orbit ao selecionar).

**f) Sessão XR** (linhas 150–151): cria o [[xr-session]] e amarra `enterVR`.

**g) Wiring data → sistemas** (linhas 154–183): conecta eventos do [[observer]] aos
métodos dos sistemas:
```js
data.on('selectionColor:set', () => system.updateHighlight());
data.on('clearSelection',     () => system.clear());
data.on('invertSelection',    () => system.invert());
data.on('exportPly', (scope)  => exportPly({ system, editSystem, scope: ... }));
data.on('addAsset', (url)     => { /* cria asset gsplat dinâmico em runtime */ });
```
O `addAsset` (linhas 168–183) cria um novo asset `gsplat`, e no `ready` chama
`system.createSelectableSplat(...)` + registra visibilidade — é o caminho de
**carregamento dinâmico** disparado pelo painel.

**h) Atalho de teclado** (linhas 185–191): `Alt+L` alterna o visualizador de labels.

**i) Loop de update** (linhas 196–207):
```js
app.on('update', (dt) => {
    try { xrSession.update(dt); } catch (err) { /* loga uma vez, continua */ }
    system.processPending();
});
```
> O `update` de XR é envolvido em `try/catch`: um *throw* por frame congelaria o
> render loop (e o *head tracking*). Loga uma vez e segue renderizando.
> `system.processPending()` consome a fila de seleções acumuladas no frame (ver
> [[selection-system]]).

**j) Cleanup** (linhas 209–214): no `destroy`, libera brush, XR, sistema e listeners.

---

## Diagrama de instanciação

```
main.mjs
 ├─ createGraphicsDevice ──► device ([[config]].deviceType)
 ├─ AppBase + init        ──► app (GSplat + XR)
 ├─ buildControls         ──► painel ([[controls]])
 ├─ createSelectionSystem ──► system ([[selection-system]])
 ├─ camera + cameraParent (rig)
 ├─ ambientLight + headlight (luz p/ malhas; splats são auto-iluminados)
 ├─ pc.Layer 'UITop' (clearDepthBuffer; painel + ícones na frente dos splats)
 ├─ createHistory         ──► history ([[history]])
 ├─ createSelectionSystem ──► system ([[selection-system]])
 ├─ camera + cameraParent (rig) ─ camera renderiza a layer UITop
 ├─ createEditSystem      ──► editSystem ([[edit-system]])
 ├─ createRetexture       ──► ([[retexture]])
 ├─ createPerfHud         ──► ([[perf-hud]])
 ├─ createSplatIndex      ──► splatIndex ([[splat-index]])
 ├─ createControllerModels ─► ([[controller-models]], uiLayer)
 ├─ createModePanel       ──► modePanel ([[mode-panel]], uiLayer)
 └─ createXrSession       ──► xrSession ([[xr-session]], splatIndex/controllerModels/panel)
```

## Atualizações (sessão atual)

- **Cena inicial:** só o **apartment** é criado (biker×2 e sample-label removidos do loader).
- **Iluminação + layer `UITop`:** ver acima — necessárias para os modelos dos controles e
  para o painel/ícones não ficarem pretos / atrás dos splats.
- **Novos sistemas instanciados:** [[history]], [[perf-hud]], [[splat-index]],
  [[controller-models]], [[mode-panel]], [[retexture]] (ver ARCHITECTURE §§7–12).
- **Defaults novos no [[observer]]:** `activeSelectionTarget`, `snapBeamRadius`,
  `retexObjects`/`retextureRunName`/`retextureStatus`/`retextureTextureUrl/Name`.
- **Teclado:** Ctrl+Z/Shift+Z/Y (undo/redo), **M** + setas (painel de modos), `/~ (HUD).
