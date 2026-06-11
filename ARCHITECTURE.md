# Arquitetura — Splatting Select

Aplicação standalone para **selecionar, editar, retexturizar e exportar regiões de
Gaussian Splats**, construída sobre a engine PlayCanvas, **sem** o navegador de
exemplos (React + PCUI + Monaco + iframes). Evoluiu do exemplo
`gaussian-splatting/paint`: o pincel deixou de pintar e passou a **marcar uma
máscara de seleção** por-splat, reutilizável para operações posteriores.

Capacidades atuais:
- **Selecionar** splats com pincel-esfera (desktop: mouse + snap na superfície; XR: raio do controle), **escopável por objeto**.
- **Editar** a seleção: mover, rotacionar, escalar (uniforme) e recolorir, com preview ao vivo.
- **Desfazer/Refazer** (pilha de operações: pinceladas, limpar/inverter, commits de edição).
- **Retexturizar** a região selecionada via serviço externo, reaplicando as transformações no resultado.
- **Exportar** para `.ply` (só a seleção ou a nuvem inteira) refletindo as edições, **incluindo SH**.
- **XR (VR)**: seleção por raio + locomoção fluida + **modelos 3D dos controles** (WebXR Input Profiles) + **painel de modos** virtual navegado por joystick.

---

## 1. Visão geral

```
┌─────────────────────────────────────────────────────────────┐
│ index.html  ── <canvas> (render) + <aside> (painel HTML)     │
│                 └── src/main.mjs (entry, type=module)        │
└─────────────────────────────────────────────────────────────┘
            │ import
            ▼
┌──────────────┐   alias "playcanvas"   ┌───────────────────────────┐
│ src/main.mjs │ ─────────────────────► │ ENGINE SOURCE (repo local)│
│ (orquestra)  │   (vite.config.mjs)    │ $ENGINE_PATH (engine/src/) │
└──────┬───────┘                        └───────────────────────────┘
       │ instancia
       ├── selection/selection-system.mjs   máscara + brush + escopo + hidden + undo de seleção
       ├── selection/brush-input.mjs         input desktop (mouse + Picker)
       ├── selection/splat-index.mjs         índice espacial CPU p/ snap em XR
       ├── edit/edit-system.mjs              preview + commit + undo + reapply de edições
       ├── export/ply-exporter.mjs           serializa PLY (mundo c/ SH, ou cru p/ retextura)
       ├── retexture.mjs                     envia seleção ao serviço, substitui pela retextura
       ├── history.mjs                       pilha undo/redo (comandos)
       ├── perf-hud.mjs                      HUD de baseline (fps/ms/copy%/sort/snap)
       ├── xr/xr-session.mjs                 sessão VR + seleção por raio + remap de input
       ├── xr/controllers.mjs                proxies de controle + raio (+ box fallback)
       ├── xr/controller-models.mjs          modelos glTF (Input Profiles) + ícones de botão
       ├── xr/mode-panel.mjs                 painel de modos world-space (lazy-follow)
       ├── xr/locomotion.mjs                 navegação pelo mundo (rig)
       ├── workbuffer-modifier.mjs           shader: realce + edições + labels + hidden
       ├── observer.mjs / config.mjs         estado + deviceType/rootPath
       └── controls.mjs                      painel HTML (two-way binding)
       │ carrega
       ▼
   public/static/...   (assets .ply/.sog, texturas, webxr-input-profiles, orbit-camera.js)
```

A engine **não** é dependência npm publicada: usa recursos de GSplat que só
existem no checkout beta local (`GSplatProcessor`, `setWorkBufferModifier`,
streams de instância, colormaps Paul Tol). Por isso `import 'playcanvas'` é
**aliasado** para o código-fonte da engine no Vite (ver seção 11).

---

## 2. Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `index.html` | Canvas de render + contêiner do painel; carrega `src/main.mjs`. |
| `src/main.mjs` | **Orquestrador.** Cria device/app (com XR), iluminação, layer `UITop`, carrega assets, monta câmera+rig, instancia os sistemas e faz o wiring de eventos. |
| `src/observer.mjs` | Store chave/valor observável mínimo (`get/set/on/emit`). Setar dispara `"<chave>:set"`. |
| `src/config.mjs` | `deviceType` (WebGL2 por padrão; `?device=webgpu`) e `rootPath`. |
| `src/controls.mjs` | Painel HTML (DOM puro) com two-way binding ao `observer`. |
| `src/history.mjs` | Pilha de undo/redo (comandos `{label, undo, redo}`), flags `canUndo`/`canRedo`. |
| `src/perf-hud.mjs` | HUD DOM de baseline lendo `app.stats.frame` (fps/ms/copy%/sort) + diagnóstico de snap. |
| `src/retexture.mjs` | Ferramenta de retextura: exporta seleção crua → POST ao serviço → substitui pela retextura; e "adicionar objeto" do catálogo. |
| `src/workbuffer-modifier.mjs` | Modifier GLSL/WGSL central (ver seção 4). |
| `src/selection/selection-system.mjs` | Splats selecionáveis, streams de instância, brush, escopo por objeto, clear/invert, hidden, highlight, labels, undo de seleção. |
| `src/selection/brush-input.mjs` | Input **desktop**: botão direito + `Picker` (snap na superfície). |
| `src/selection/splat-index.mjs` | Índice espacial (grade hash) sobre os centros editados; ray-march CPU para snap em XR (núcleo puro, testável em Node). |
| `src/edit/edit-system.mjs` | Edições (mover/rotar/escalar/cor): preview por uniforms, commit no mirror CPU, undo, `reapplyEdits` (retextura). |
| `src/export/ply-exporter.mjs` | `buildPlyBlob` (mundo, edições, **SH pass-through**), `buildRawSelectionPly` (coords originais p/ serviço), `exportPly` (download). |
| `src/xr/xr-session.mjs` | Sessão VR, controllers, seleção por raio, snap por índice CPU, remap de input (painel/locomoção/brush). |
| `src/xr/controllers.mjs` | Entidade de controle (posada no grip) + raio + box `fallbackBox`. |
| `src/xr/controller-models.mjs` | Modelos glTF dos controles (WebXR Input Profiles), feedback de botões, ícones de ação. |
| `src/xr/mode-panel.mjs` | Painel de modos world-space (canvas→textura), lazy-follow, navegação por joystick. |
| `src/xr/locomotion.mjs` | Locomoção: move o rig (`cameraParent`) por analógico. |

---

## 3. Estruturas de dados — streams de instância (por entidade, na GPU)

Cada splat selecionável (entidade `gsplat`, `unified: true`) recebe streams de
instância extras (`addExtraStreams`, `GSPLAT_STREAM_INSTANCE`), todos indexados
por `splat.uv` (`i → (i%w, floor(i/w))`):

| Stream | Formato | Papel | Default |
|---|---|---|---|
| `selectionMask` | `R8` | 255 = selecionado, 0 = não | 0 |
| `editQuat` | `RGBA32F` | rotação acumulada (x,y,z,w) | identidade `(0,0,0,1)` |
| `editTS` | `RGBA32F` | xyz = translação, w = escala uniforme | `(0,0,0,1)` |
| `editColor` | `RGBA8` | cor absoluta + a = flag de override | `0` |
| `hidden` | `R8` | 255 = oculto (região substituída por retextura) → `color.a=0` | 0 |
| `splatLabel` | `R8` | rótulo por-splat (vindo do `.ply`) | do asset |

As edições são uma **transformação de similaridade por-splat** aplicada ao centro
**base** que a GPU já fornece: `editado = editTS.xyz + editTS.w · rot(editQuat, baseWorld)`.
Defaults de identidade = pass-through (nenhuma edição visível).

**Mirror na CPU (em `edit-system`):** arrays `Float32Array`/`Uint8Array` espelhando
`editQuat`/`editTS`/`editColor`. É a **edit-list acumulada** (fonte de verdade do
export) e permite compor operações sem ler dados-base da CPU.

---

## 4. Modifier (`workbuffer-modifier.mjs`) — o coração visual

Roda no passe "copy to work buffer" (chunks `gsplatCopyToWorkbuffer` + `gsplatModify`)
em **espaço-mundo**, com acesso aos streams via `texelFetch`. As três funções:

- `modifySplatCenter`: aplica a edição commitada (`editTS`+`editQuat`) e, se o
  splat está selecionado e há op ativo, aplica também o **preview** da operação.
- `modifySplatRotationScale`: compõe rotação (`qmul`) e escala das edições + preview.
- `modifySplatColor`: se `hidden` → `color.a = 0` (sai cedo); senão override de cor
  commitada → preview de cor → label viewer (HSV / paletas **Paul Tol**) → **realce**
  dos selecionados (cor/força ajustáveis).

**Atualização sob demanda:** o `workBufferUpdate` fica em `WORKBUFFER_UPDATE_ONCE`
disparado após cada mudança (seleção/edição/realce/label/hidden). Evita-se `ALWAYS`
(reconstrói todos os splats todo frame, dobrado no estéreo do VR — principal custo).
O re-render é **incremental por placement/entidade** (a flag marca só a entidade
alterada), não da cena toda — ver §10.

---

## 5. Seleção (`selection-system.mjs` + `brush-input.mjs`)

- Um `GSplatProcessor` por entidade escreve `selectionMask` para os splats dentro
  da esfera do pincel, testando a posição **editada** do splat. Re-selecionar acerta
  onde os splats estão **agora**.
- **Acúmulo aditivo/subtrativo** via equações de blend (MAX/MIN) — sem ler+escrever o mesmo stream.
- **Escopo por objeto:** `activeSelectionTarget` ('all' ou nome da entidade) — o brush
  (`processPending`) só marca o objeto ativo, ignorando interseções da esfera com outros.
- `clear()` zera; `invert()` faz readback → inverte → re-upload.
- **Undo de seleção:** pinceladas (entre `beginStroke`/`endStroke`), `clear` e `invert`
  capturam snapshots da máscara (antes/depois) e empilham um comando em `history`.
- `hideSelected()` marca o stream `hidden` dos splats da máscara (usado pela retextura).
- **Desktop**: botão direito + `Picker.getWorldPointAsync` (snap na superfície; WebGL-only).

---

## 6. Edição (`edit-system.mjs`)

- **Preview ao vivo**: uniforms `uActive*` aplicam a operação ativa aos selecionados (sem custo de CPU).
- **Pivô** = centróide (mundo) da seleção atual (readback da máscara + `getCenters`, aplicando o mirror).
- **Commit**: compõe a op no mirror CPU e faz upload aos streams; captura os valores
  anteriores/posteriores **apenas dos splats afetados** e empilha um comando de undo
  (memória ∝ tamanho da seleção). Empilhável.
- **`reapplyEdits(target, src, srcIndices)`**: copia o mirror por-splat de um objeto
  para outro (1:1 por índice) — usado pela retextura para reaplicar as edições ao ply retornado.
- Escala restrita a **uniforme** (similaridade) — composição limpa e armazenamento compacto.

---

## 7. Undo/Redo (`history.mjs`)

Pilha de **comandos** `{ label, undo(), redo() }`. Cada comando carrega o mínimo para
se reverter (op-stack): edições guardam prev/next dos splats afetados; operações de
seleção guardam snapshots da máscara. Push limpa o redo; profundidade limitada.
Flags observáveis `canUndo`/`canRedo`. Eventos `undo`/`redo` (atalhos Ctrl+Z /
Ctrl+Shift+Z / Ctrl+Y; botões no painel). **Undo não custa renderização** — é só estado CPU.

---

## 8. Snap em XR (`splat-index.mjs`)

Em XR o `Picker` (readback GPU) causava hitch e é WebGL-only. O snap usa um **índice
espacial em CPU**: grade hash sobre os centros **editados** dos splats (do objeto ativo),
construída sob demanda (rebuild no commit / troca de escopo). O `raycast(origin, dir)`
faz ray-march e retorna a **profundidade `t` no raio** (lateral fica 1:1 no raio; só a
profundidade é snapada). O consumidor (`xr-session`) suaviza a profundidade (τ≈0.05 s) e
faz **gate de saltos** (>0.4 m precisam persistir alguns frames) para evitar flicker.

- `cellSize` ≈ raio do beam de snap (`snapBeamRadius`) → vizinhança da query fica ~1.
- Núcleo (`buildGrid`/`raycastGrid`) é **puro** (sem `pc`), testável em Node
  (`scripts/test-splat-index.mjs`). Bench: ~7 µs/raio a 1M splats (desprezível).

---

## 9. Export PLY (`ply-exporter.mjs`)

Serializa **PLY binário little-endian**. Dois caminhos:

- **`buildPlyBlob` / `exportPly`** (download): saída em **espaço-mundo** (placement +
  edições aplicados), unindo múltiplos objetos. Inclui **SH de ordem alta (`f_rest_*`)
  por pass-through** quando a origem os tem (colunas uniformes pelo máximo entre objetos).
  *Limitação:* os SH **não** são rotacionados (Wigner-D) — sob rotação de entidade/edição
  a cor view-dependent fica inexata (warning logado). Ver `docs/sh-rotation-study.md`.
- **`buildRawSelectionPly`** (retextura): exporta a seleção em **coords originais/locais**
  (sem placement, sem edição, sem override), **um objeto só** — fiel ao ply de origem,
  com SH no frame original. Retorna `src` + `indices` para a reaplicação.

`posOut = t + s·rot(q, M·posLocal)` · `rotOut = qEdit ⊗ (qEntity ⊗ qLocal)` ·
`scaleOut = log(entityScale · exp(scaleLog) · sEdit)` · `colorOut = override ? (rgb−0.5)/SH_C0 : f_dc`.

---

## 10. Retextura (`retexture.mjs`)

Substitui a região selecionada por uma versão retexturizada vinda de um serviço externo.

**Serviço** (porta 5000, na máquina do dev server). API: `POST /api/v1/retexture`
(multipart: `run_name`, `file_selected`=.ply, `file_texture`=imagem) → JSON
`{status, combined_ply_url, log_url}`; e `GET /download_ply/{name}` (catálogo de objetos
treinados; pode redirecionar p/ o arquivo final, ex.: `Fruits` → `40000.ply`).

**Rede via proxy Vite** (`/retex`): o browser fala same-origin/HTTPS e o Vite repassa ao
serviço local — evita **mixed-content** (WebXR é HTTPS) e **CORS**, e funciona do headset.
Duas regras: `/retex/download_ply` (com `followRedirects`, GET sem corpo) e `/retex`
(POST sem `followRedirects`, pois o upload grande estoura o limite de body da lib).

**Fluxo `applyRetexture`:** `buildRawSelectionPly` (coords originais, 1 objeto) → POST →
baixa `combined_ply_url` (reescrito p/ o proxy) → novo objeto selecionável → **reaplica a
transformação**: copia o transform local da entidade de origem e, se a contagem bater 1:1,
`editSystem.reapplyEdits` (mirror por-splat) → `hideSelected()` + `clearSelection`.
Exportar local e reaplicar via **entidade** faz o renderizador tratar os SH sob rotação —
sem Wigner-D. Requer que o serviço **preserve contagem/ordem** dos splats.

**Adicionar objeto (`addRetexObject`):** baixa `/download_ply/{retextureRunName}` (catálogo
`retexObjects`, por enquanto `['Fruits']`) e adiciona como objeto selecionável com label = nome.

---

## 11. Integração com a engine + XR

- **Alias de source** (`vite.config.mjs`): `playcanvas` → engine local (`src/index.js`),
  via `ENGINE_PATH` (ver `.env.example`). `fflate` aliasado para o build ESM browser.
- **Proxy** `/retex` → serviço de retextura (ver §10). **`server.fs.allow`**, **`host`/
  `allowedHosts`** liberam servir a engine e o acesso por LAN/túnel HTTPS (Quest).
- **WebGL2 por padrão** (o `Picker` de snap desktop é WebGL-only). WebGPU opt-in (`?device=webgpu`).
- **Iluminação:** a cena ganha `ambientLight` + uma luz direcional "headlight" filha da
  câmera — os splats são auto-iluminados, mas malhas (modelos dos controles, box) ficariam pretas sem luz.
- **Layer `UITop`** (`clearDepthBuffer`, renderizada após o World): recebe o painel de modos
  e os ícones dos controles, para que os gaussianos **não os ocultem**.
- **XR**: câmera filha de um **rig `cameraParent`**; a locomoção move o rig (nunca a câmera).
  Modelos de controle via **WebXR Input Profiles** (assets vendorizados em
  `public/static/webxr-input-profiles/`), com feedback de botões e ícones de ação.

**Controles XR (remapeados):** **A** (direito) abre/fecha o **painel de modos**. Com o
painel **aberto**: stick esquerdo navega (vertical = foco, horizontal = troca de modo no
cabeçalho ou ajuste contínuo nas linhas numéricas), gatilho confirma, B fecha — locomoção e
brush suspensos. Com o painel **fechado**: locomoção sempre disponível; o brush de seleção
age só no modo **Seleção**; **X/Y** (esquerdo) diminuem/aumentam o pincel. Ícones sobre os
botões: grade (menu/A), ponto (gatilho), − (X), + (Y).

---

## 12. Painel de modos (`mode-panel.mjs`)

UI world-space desenhada num **canvas → textura** num quad, com **lazy-follow** à frente da
cabeça. Modelo declarativo de **modos** (Seleção / Edição / Exportar / Retexturizar; cabeçalho
troca de modo via ◀▶) + **itens globais** (Desfazer/Refazer/Labels). Navegação: vertical move
o foco; horizontal troca o modo (cabeçalho) ou ajusta o valor (contínuo nas linhas numéricas,
cíclico em Op/Eixo/Objeto); o gatilho confirma ações. Funciona no **desktop** (lazy-follow na
câmera; teclas **M** abre, setas/Enter/Esc), o que permite testar sem headset.

Detalhe de orientação: a engine não dá `flipY` em texturas de canvas, então o `redraw`
**pré-rotaciona 180°** o desenho para o painel sair legível e não-espelhado no quad.

---

## 13. Estado e UI

`src/observer.mjs` é a fonte única de estado. Painel HTML, painel de modos e sistemas reagem
aos mesmos eventos (`<chave>:set` e eventos como `clearSelection`/`commitEdit`/`exportPly`/
`undo`/`redo`/`applyRetexture`/`addRetexObject`/`enterVR`). Chaves principais:
`selectionMode`, `activeSelectionTarget`, `brushSize`, `selectionColor/Strength`,
`edit{Tx,Ty,Tz,Rx,Ry,Rz,Scale,Color,ColorEnabled}`, `editing`, `label*`, `canUndo`/`canRedo`,
`xr{RayVisible,RayDistance,MoveSpeed,SnapToSurface}`, `snapBeamRadius`,
`retex{Objects}`/`retextureRunName`/`retextureStatus`/`retextureTextureUrl/Name`,
`assetVisibilityItems`.

---

## 14. Trabalho futuro

### Rotação de SH (Wigner-D) — pendente para o export em arquivo
O `exportPly` (arquivo, world-space) inclui SH por **pass-through**, mas **não os rotaciona**.
Sob rotação de entidade/edição a cor view-dependent fica inexata. A retextura contorna isso
exportando **cru** e reaplicando via entidade. Ver `docs/sh-rotation-study.md`.

### Performance — preview-layer (não implementado, decisão de escopo)
O re-render do work buffer já é **incremental por entidade**, mas editar uma seleção pequena
dentro de um objeto grande re-renderiza o objeto inteiro a cada frame do drag. Isolar a seleção
numa entidade leve reduziria isso a ∝ tamanho da seleção. O *baseline* é medível pelo
[HUD](#2-estrutura-de-arquivos) (`copy%` PEAK). Throttle/early-out foram descartados (o flag
já coalesce por frame; o custo é a rasterização, não a ALU do modifier).

### Outros
- **Manipulação por mão (grip-grab)** do mundo/objetos — fora do escopo atual.
- **Retextura multi-objeto** e robustez quando o serviço altera contagem/ordem dos splats.
- **Polling** do resultado caso o serviço responda antes do ply ficar pronto.
- **Snap-na-superfície** mais fino (snap a centros de splat → suavização de profundidade já cobre o jitter).
- **Múltiplas texturas / catálogo de objetos** maior na retextura (hoje uma textura, `['Fruits']`).
- **Máscaras nomeadas** reutilizáveis; export configurável de coords (mundo vs. local).
- `npm run build` (produção) ainda não validado end-to-end; foco no `npm run dev`.
