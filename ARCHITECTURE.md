# Arquitetura — Splatting Select

Aplicação standalone para **selecionar, editar e exportar regiões de Gaussian
Splats**, construída sobre a engine PlayCanvas, **sem** o navegador de exemplos
(React + PCUI + Monaco + iframes). Evoluiu do exemplo `gaussian-splatting/paint`:
o pincel deixou de pintar e passou a **marcar uma máscara de seleção** por-splat,
reutilizável para operações posteriores.

Capacidades atuais:
- **Selecionar** splats com pincel-esfera (desktop: mouse + snap na superfície; XR: raio do controle).
- **Editar** a seleção: mover, rotacionar, escalar (uniforme) e recolorir, com preview ao vivo.
- **Exportar** para `.ply` (só a seleção ou a nuvem inteira) refletindo as edições.
- **XR (VR)**: seleção por raio + locomoção fluida pelo mundo.

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
│ (orquestra)  │   (vite.config.mjs)    │ 3gs-mask-studio/src/...    │
└──────┬───────┘                        └───────────────────────────┘
       │ instancia
       ├── selection/selection-system.mjs   máscara + brush (GSplatProcessor)
       ├── selection/brush-input.mjs         input desktop (mouse + Picker)
       ├── edit/edit-system.mjs              preview + commit das edições
       ├── export/ply-exporter.mjs           serializa PLY (mundo + edições)
       ├── xr/xr-session.mjs                 sessão VR + seleção por raio
       ├── xr/controllers.mjs                proxies de controle + raio
       ├── xr/locomotion.mjs                 navegação pelo mundo (rig)
       ├── workbuffer-modifier.mjs           shader: realce + edições + labels
       ├── observer.mjs / config.mjs         estado + deviceType/rootPath
       └── controls.mjs                      painel HTML (two-way binding)
       │ carrega
       ▼
   public/static/...   (assets .ply/.sog + orbit-camera.js)
```

A engine **não** é dependência npm publicada: usa recursos de GSplat que só
existem no checkout beta local (`GSplatProcessor`, `setWorkBufferModifier`,
streams de instância, colormaps Paul Tol). Por isso `import 'playcanvas'` é
**aliasado** para o código-fonte da engine no Vite (ver seção 8).

---

## 2. Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `index.html` | Canvas de render + contêiner do painel; carrega `src/main.mjs`. |
| `src/main.mjs` | **Orquestrador.** Cria device/app (com XR), carrega assets, monta câmera+rig, instancia os sistemas e faz o wiring de eventos. |
| `src/observer.mjs` | Store chave/valor observável mínimo (`get/set/on/emit`). Setar dispara `"<chave>:set"`. |
| `src/config.mjs` | `deviceType` (WebGL2 por padrão; `?device=webgpu`) e `rootPath`. |
| `src/controls.mjs` | Painel HTML (DOM puro) com two-way binding ao `observer`. |
| `src/workbuffer-modifier.mjs` | Modifier GLSL/WGSL central (ver seção 4). |
| `src/selection/selection-system.mjs` | Cria os splats selecionáveis, gerencia streams de instância, brush de seleção, clear/invert, highlight, labels. |
| `src/selection/brush-input.mjs` | Input **desktop**: botão direito + `Picker` (snap na superfície). |
| `src/edit/edit-system.mjs` | Edições (mover/rotar/escalar/cor): preview por uniforms + commit no mirror CPU + pivô. |
| `src/export/ply-exporter.mjs` | Serializa PLY binário aplicando as edições (mundo). |
| `src/xr/xr-session.mjs` | Sessão VR, controllers, seleção por raio (brush a distância ajustável), feedback (esfera). |
| `src/xr/controllers.mjs` | Entidades de controle (proxy box) + raio. |
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
- `modifySplatColor`: override de cor commitada → preview de cor → label viewer
  (HSV / paletas **Paul Tol**) → **realce** dos selecionados (cor/força ajustáveis).

Uniforms (via `gsplatComponent.setParameter`): `uHasActiveOp`, `uActive{Quat,TS,Pivot,Color}`,
`uSelHighlight{Color,Strength}`, `uLabel*`.

**Atualização sob demanda:** o `workBufferUpdate` fica em `WORKBUFFER_UPDATE_ONCE`
disparado após cada mudança (seleção/edição/realce/label). Evita-se `ALWAYS`
(reconstrói todos os splats todo frame, dobrado no estéreo do VR — principal custo).

---

## 5. Seleção (`selection-system.mjs` + `brush-input.mjs`)

- Um `GSplatProcessor` por entidade escreve `selectionMask` para os splats dentro
  da esfera do pincel. O brush é dado em **espaço-mundo** e o shader testa a
  posição **editada** do splat (`uModelMatrix` + `editQuat`/`editTS`), então
  re-selecionar acerta onde os splats estão **agora**, não na posição original.
- **Acúmulo aditivo/subtrativo** sem ler+escrever o mesmo stream: usa equações de
  blend — **MAX** (aditivo: escreve 1 dentro) e **MIN** (subtrativo: escreve 0 dentro).
- `clear()` zera a textura; `invert()` faz readback → inverte → re-upload.
- **Desktop**: botão direito + `Picker.getWorldPointAsync` (snap na superfície do
  splat; WebGL-only). Shift inverte o modo. Esquerdo/roda orbitam.

---

## 6. Edição (`edit-system.mjs`)

- **Preview ao vivo**: uniforms `uActive*` aplicam a operação ativa aos splats
  selecionados (sem custo de CPU).
- **Pivô** = centróide (mundo) da seleção atual — readback da máscara + `getCenters`,
  aplicando o mirror para usar as posições **editadas**.
- **Commit**: para cada splat selecionado, compõe a op no mirror CPU
  (`q' = Ra⊗q`, `s' = sa·s`, `t' = P + sa·Ra·(t−P) + ta`) e faz upload aos streams;
  reseta a op ativa. Empilhável.
- Escala restrita a **uniforme** (similaridade) — composição limpa e armazenamento compacto.

---

## 7. Export PLY (`ply-exporter.mjs`)

Serializa **PLY binário little-endian** aplicando na CPU a mesma matemática do
shader, sobre os dados originais (decomprimidos sob demanda via `decompress()` para
comprimido/SOG, ou `getProp` para não-comprimido). Saída em **espaço-mundo**
(placement das entidades embutido), unindo múltiplos splats num frame consistente.

- `posOut = t + s·rot(q, M·posLocal)`
- `rotOut = qEdit ⊗ (qEntity ⊗ qLocal)` (rot_0 = w)
- `scaleOut = log(entityScale · exp(scaleLog) · sEdit)`
- `colorOut = override ? (rgb−0.5)/SH_C0 : f_dc`

Escopo: **subset** (filtra por `selectionMask`) ou **whole**. Download via `Blob`.
Limitações: **só cor DC** (SH de ordem alta descartado — ver §10) e escala de
entidade/edição **uniforme**.

---

## 8. Integração com a engine + XR

- **Alias de source** (`vite.config.mjs`): `playcanvas` → `…/3gs-mask-studio/src/index.js`,
  para acessar os recursos beta de GSplat sem um build separado. Override por `ENGINE_PATH`.
- **`fflate`** aliasado para o build ESM browser (única dep de runtime da engine).
- **`server.fs.allow`** libera servir a engine (fora da raiz); **`host`/`allowedHosts`**
  liberam acesso por LAN/túnel HTTPS (teste de WebXR no headset).
- **`window.pc`**: ponte para o script clássico `orbit-camera.js`.
- **WebGL2 por padrão** (o `Picker` de snap é WebGL-only; Quest usa WebGL). WebGPU opt-in.
- **XR habilitado** no `AppOptions` (`xr = pc.XrManager`, `keyboard`, `xrCompatible`).
  A câmera é filha de um **rig `cameraParent`**; a engine escreve a pose do HMD na
  câmera, e a **locomoção move o rig** (nunca a câmera). Ao entrar em VR, o
  orbit-camera é desabilitado para não brigar com o HMD.

**Controles XR** (resumo): trigger direito = selecionar (esfera verde=aditivo /
vermelho=subtrativo na ponta do raio); analógico esquerdo = mover; direito X = giro
suave, direito Y = subir/descer; A = alterna modo, B = limpa; X/Y (esquerdo) = tamanho
do pincel. O `app.on('update')` envolve o update XR em try/catch (um erro de frame
não congela o render/HMD).

---

## 9. Estado e UI

`src/observer.mjs` é a fonte única de estado. Painel e sistemas reagem aos mesmos
eventos (`<chave>:set`, e eventos como `clearSelection`/`commitEdit`/`exportPly`/`enterVR`).
Chaves principais: `selectionMode`, `brushSize`, `selectionColor/Strength`,
`edit{Tx,Ty,Tz,Rx,Ry,Rz,Scale,Color,ColorEnabled}`, `editing`, `label*`,
`xr{RayVisible,RayDistance,MoveSpeed,SnapToSurface}`, `assetVisibilityItems`.

---

## 10. Trabalho futuro

### ⭐ Alta prioridade — Export de SH de ordem alta (cor view-dependent)
O exportador grava **apenas a cor DC** (`f_dc_0..2`) e descarta os SH de ordem alta
(`f_rest_*`). Para suportar: ler os SH (`decompress()` já reconstrói `f_rest_*` quando
`shBands > 0`), **rotacionar os coeficientes** quando o splat é rotacionado (SH não são
invariantes a rotação — precisam de rotação por banda / Wigner-D) e acrescentar as
propriedades ao header/corpo PLY. Hoje o export reflete geometria + cor base, mas perde
o realce direcional.

### Manipulação do mundo/objetos pela mão (agarrar) — fora do escopo atual
Despriorizada. A ideia: manipular o mundo agarrando com os controles — **1 grip** arrasta
(translação 1:1); **2 grips** ancoram nas duas mãos mapeando translação + rotação + escala
uniforme (estilo Gravity Sketch). A Fase 4 implementa **apenas locomoção por analógico**;
o grip fica livre para isso.

### Outros
- **Máscara reutilizável**: export/import do `selectionMask` como artefato para outros utilitários.
- **Múltiplas máscaras nomeadas** (ids 1..N no `selectionMask`), com grupo ativo alternável.
- **Snap-na-superfície robusto em XR** (o `Picker` se mostrou instável dentro da sessão XR;
  hoje o brush XR usa distância fixa ajustável ao longo do raio, com snap experimental opt-in).
- **Fallback WebGPU** para o snap desktop (o `Picker` é WebGL-only).
- Export configurável de coordenadas (mundo vs. local) e escala não-uniforme.
- `npm run build` (produção) ainda não validado end-to-end; foco no `npm run dev`.
