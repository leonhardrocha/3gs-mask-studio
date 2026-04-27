# 📝 Plano de Migração — 3GS Mask Studio

> **Princípio diretor**: o código-fonte dos submódulos **não é alterado**.
> Todo código de produto vive em `app/` e `tools/`, como scripts modulares
> `.mjs` que se integram ao ciclo de vida da engine via `pc.Script`.

---

## Submódulos do workspace

| Pasta              | Repositório                                         | Papel                                               |
|--------------------|-----------------------------------------------------|-----------------------------------------------------|
| `engine/`          | https://github.com/playcanvas/engine                | Motor de renderização 3GS + API de scripts          |
| `editor/`          | https://github.com/playcanvas/editor                | Editor visual PlayCanvas (criação de cena/assets)   |
| `supersplat/`      | https://github.com/playcanvas/supersplat            | Editor de Gaussian Splats (não alterado)            |
| `splat-transform/` | https://github.com/playcanvas/splat-transform       | CLI de pós-processamento do `.ply`                  |

Inicializar todos:

```bash
git submodule update --init --recursive
```

---

## Por que usar engine + pc.Script em vez de alterar o SuperSplat

O PlayCanvas trata Gaussian Splatting como componente de primeira classe desde
a versão 1.65 (`pc.GSplatComponent`).  
Referência oficial: https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/

| Recurso                   | SuperSplat (fork) | Engine + pc.Script (este projeto) |
|---------------------------|-------------------|-----------------------------------|
| Código-fonte original     | Alterado          | Intocado                          |
| Atualização via git pull  | Conflitos         | Transparente                      |
| Reutilização do script    | Acoplado ao app   | Qualquer projeto PlayCanvas       |
| Acesso a WebXR            | Indireto          | `this.app.xr` nativo              |
| Suporte 3GS nativo        | Via SuperSplat    | `pc.GSplatComponent` direto       |

---

## Estrutura do projeto (apenas código próprio)

```
app/
  index.html                  # host mínimo do app PlayCanvas
  main.mjs                    # cria pc.Application, carrega splat, anexa scripts
  scripts/
    vr-masker.mjs             # pc.Script — seleção por cone + envio ao bridge
    ply-exporter.mjs          # utilitário — exporta buffer PLY binário (opacity_raw)
    cone-shader.vert.glsl     # shader GLSL — cone helper visual (uso futuro)
    cone-shader.frag.glsl     # shader GLSL — cone helper visual (uso futuro)
tools/
  bridge-server/              # servidor Node.js — recebe PLY, executa CLI
```

---

## Como os scripts modulares `.mjs` funcionam na Engine

Os arquivos de demo oficiais da engine seguem exatamente este padrão e ficam em:

```
engine/examples/src/examples/gaussian-splatting/
  simple.example.mjs
  viewer.example.mjs
  shader-effects.example.mjs         ← shader customizado sobre GSplat
  multi-splat.shader.glsl.vert       ← vertex shader de referência
```

Um script de "jogo" PlayCanvas usa `pc.createScript` e é estruturado assim:

```js
// app/scripts/vr-masker.mjs
import * as pc from '../../engine/build/playcanvas/src/index.js';

const VrMasker = pc.createScript('vrMasker');

VrMasker.attributes.add('coneAngleDeg', { type: 'number', default: 30 });
VrMasker.attributes.add('coneRange',    { type: 'number', default: 5  });
VrMasker.attributes.add('bridgeUrl',    { type: 'string',
    default: 'http://localhost:3001/process-mask' });

VrMasker.prototype.initialize = function () {
    this._selected = new Set();
    // Escuta input XR
    this.app.xr?.input.on('add', src => { this._xrSource = src; });
};

VrMasker.prototype.update = function (dt) {
    const trigger = this._xrSource?.getButton(0) ??
                    this.app.keyboard.isPressed(pc.KEY_SPACE);
    if (trigger) this._doSelection();
    else if (this._wasActive) this._sendToBridge();
    this._wasActive = trigger;
};
```

---

## Matemática de seleção por cone

O predicado opera no **espaço local do controlador XR** para evitar operações
de matriz por ponto. Um ponto $p$ está dentro do cone se:

$$0 < d_{\text{proj}} < h \qquad \text{e} \qquad \sqrt{x_L^2 + y_L^2} < d_{\text{proj}} \cdot \tan(\theta)$$

Onde $d_{\text{proj}} = -z_L$ é a profundidade no eixo local do controlador
(eixo $-Z$ = frente), e $\theta$ é o ângulo do cone.

---

## Shaders GLSL — cone helper visual (uso futuro)

Os shaders abaixo seguem a estrutura de
`engine/examples/src/examples/gaussian-splatting/shader-effects.example.mjs`
e serão aplicados a uma primitiva criada via **PlayCanvas Editor** (`editor/`).

### Vertex shader — `app/scripts/cone-shader.vert.glsl`

```glsl
// cone-shader.vert.glsl
// Primitiva de cone que representa o volume de seleção VR.
// Uniforms injetados automaticamente pela engine:
//   matrix_viewProjection, matrix_model

attribute vec4 aPosition;

uniform mat4  matrix_viewProjection;
uniform mat4  matrix_model;
uniform float uConeRange;       // comprimento do cone em metros
uniform float uConeAngleTan;    // tan(coneAngleDeg * PI / 180)

varying vec3 vLocalPos;

void main(void) {
    vLocalPos = aPosition.xyz;

    // Escala a primitiva para corresponder ao cone configurado
    vec4 scaled = aPosition;
    scaled.y   *= uConeRange;                     // eixo de profundidade
    scaled.xz  *= uConeRange * uConeAngleTan;     // raio radial

    gl_Position = matrix_viewProjection * matrix_model * scaled;
}
```

### Fragment shader — `app/scripts/cone-shader.frag.glsl`

```glsl
// cone-shader.frag.glsl
// Decaimento gaussiano para feedback visual suave do cone.
// Mesmo padrão do fragment shader 3GS:
//   float alpha = exp(-0.5 * dot(d, d)) * opacity;

precision mediump float;

varying vec3 vLocalPos;
uniform vec4 uConeColor;   // ex.: vec4(0.2, 0.8, 1.0, 0.3)

void main(void) {
    // Distância radial normalizada (0 = eixo central, 1 = borda)
    float r = length(vLocalPos.xz);

    // Decaimento gaussiano radial — mesma função dos splats
    float alpha = exp(-2.0 * r * r) * uConeColor.a;

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(uConeColor.rgb, alpha);
}
```

> Os shaders serão aplicados via `pc.ShaderMaterial` a uma primitiva criada no
> **PlayCanvas Editor** (`editor/`, submódulo `v2.20.8`), que usa a mesma
> engine como dependência.

---

## Pipeline CLI sem hardcode (bridge)

Para evitar lógica fixa no bridge, o processamento deve ser dividido em 3 etapas
parametrizadas por variáveis de ambiente:

- `SELECT_CLI_CMD`: isola as gaussianas selecionadas pelo cone.
- `MASK_CLI_CMD`: aplica pós-processamento de máscara/limpeza.
- `EXPORT_CLI_CMD`: gera o arquivo final com sufixo `_output`.

### Contrato de placeholders (proposto)

Além de `{input}` e `{output}`, o bridge deve suportar placeholders intermediários
para encadear comandos sem hardcode de caminho:

- `{input}`: arquivo recebido no `POST /process-mask`.
- `{selected}`: saída da etapa de seleção.
- `{masked}`: saída da etapa de máscara.
- `{output}`: saída final definida pelo bridge (com sufixo).

### Comandos sugeridos

```env
# 1) Seleção: mantém apenas gaussianas marcadas no exportador VR
# Convenção atual do app: opacity_raw = +100 (selecionada), -100 (não selecionada)
SELECT_CLI_CMD=splat-transform -w {input} -V opacity_raw,gt,0 {selected}

# 2) Máscara/limpeza: remove floaters na nuvem já selecionada
# Formato: -G [voxelSize,opacityCutoff,minContribution]
MASK_CLI_CMD=splat-transform -w {selected} -G 0.05,0.1,0.004 {masked}

# 3) Export final: grava o resultado final em .ply
EXPORT_CLI_CMD=splat-transform -w {masked} {output}
```

### Regra de nome de saída (sufixo `_output`)

O bridge deve derivar `{output}` a partir do nome base do arquivo de entrada:

- Entrada: `scene.ply`
- Saída: `scene_output.ply`

Se necessário, manter em `.env` um sufixo configurável:

```env
MASK_OUTPUT_SUFFIX=_output
MASK_OUTPUT_EXT=.ply
```

### Observações sobre `-V` vs `-G`

- `-V` (`--filter-value`) é o filtro determinístico da seleção do cone
  (recomendado para etapa `SELECT_CLI_CMD`).
- `-G` (`--filter-floaters`) é limpeza geométrica adicional após seleção
  (recomendado para etapa `MASK_CLI_CMD`).
- Para o caso "manter somente seleção", `SELECT_CLI_CMD` sozinho já resolve.

---

## Plano de fases

### Fase 1 — Ambiente

- [x] Submódulos: `engine`, `editor`, `supersplat`, `splat-transform`.
- [x] `npm install` em `supersplat/` e `tools/bridge-server/`.
- [x] Bridge server operando (`tools/bridge-server/`).

### Fase 2 — App Engine standalone (`feat/engine-app`)

- [x] `app/index.html`, `app/main.mjs`, `app/package.json` criados.
- [x] `app/scripts/vr-masker.mjs` — `pc.Script` com cone + bridge.
- [x] Renomear `main.js` → `main.mjs` (ESM puro, sem `require`).
- [x] Validar fluxo `?splat=<url>` (parsing da query + tentativa de carga via `app.assets.loadFromUrl`).

### Fase 3 — Shaders e primitiva de cone

- [x] Criar `app/scripts/cone-shader.vert.glsl` e `cone-shader.frag.glsl`.
- [x] Suportar primitiva de cone como asset de cena (`ConeHelper`) com fallback runtime.
- [x] Aplicar `pc.ShaderMaterial` com os shaders acima ao cone helper.
- [x] Ligar posição/rotação do cone ao controlador XR em tempo real.

### Fase 4 — Pipeline completo

- [x] Round-trip validado: seleção VR → PLY exportado → bridge → `splat-transform` → artefato.
- [x] Testes: `cone-math`, `ply-exporter`, `round-trip` em `tools/bridge-server`.

### Fase 5 — Performance

- [x] Seleção incremental (chunks) para evitar stutter em VR (> 1M gaussianas).
- [x] Web Worker opcional para seleção fora da thread de renderização (com fallback local).

### Fase 6 — Pipeline CLI configurável (sem hardcode)

- [x] Expandir bridge para suportar `SELECT_CLI_CMD`, `MASK_CLI_CMD`, `EXPORT_CLI_CMD`.
- [x] Implementar execução em cadeia com arquivos temporários (`{selected}` → `{masked}` → `{output}`).
- [x] Validar placeholders obrigatórios e retornar erro 501/400 com mensagem clara quando ausentes.
- [x] Preservar compatibilidade: se só `MASK_CLI_CMD` existir, manter modo legado de etapa única.

### Fase 7 — Política de saída e export

- [x] Implementar nome de saída com sufixo `_output` sobre o basename de entrada.
- [x] Tornar sufixo/extensão configuráveis por ambiente (`MASK_OUTPUT_SUFFIX`, `MASK_OUTPUT_EXT`).
- [x] Garantir `-w/--overwrite` em todos os comandos para evitar falhas por arquivo existente.
- [x] Cobrir com testes de contrato: nome final, encadeamento e fallback legado.

---

## Análise — Problemas de renderização e ferramenta de seleção

> Diagnóstico realizado após teste manual do fluxo descrito no README. Os
> comandos CLI funcionam (bridge validado em HTTP), mas o viewer não renderiza
> e não há ferramenta de seleção por cone visível.

### Raiz dos problemas identificados

#### Problema 1 — `app/main.mjs` usa a API legada `pc.Application`

A engine PlayCanvas tem duas superfícies de API:

| API | Status | Suporte GSplat |
|-----|--------|----------------|
| `pc.Application(canvas, opts)` | **Legada** — ainda presente mas não registra sistemas automaticamente | Não registra `GSplatComponentSystem` por padrão |
| `pc.AppBase` + `pc.AppOptions` | **Atual** — usada por todos os exemplos oficiais | Exige registro explícito de `GSplatComponentSystem` e `GSplatHandler` |

O `app/main.mjs` atual cria `new pc.Application(canvas, {...})` sem registrar
os sistemas de GSplat. Mesmo que o arquivo `.ply` seja carregado, a engine não
sabe renderizá-lo porque `GSplatComponentSystem` está ausente.

**Evidência**: todos os exemplos em `engine/examples/src/examples/gaussian-splatting/`
usam o padrão:

```js
const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;
createOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.GSplatComponentSystem    // ← obrigatório
];
createOptions.resourceHandlers = [
    pc.TextureHandler,
    pc.ContainerHandler,
    pc.GSplatHandler            // ← obrigatório para carregar .ply como gsplat
];
const app = new pc.AppBase(canvas);
app.init(createOptions);
```

Referência: `engine/examples/src/examples/gaussian-splatting/simple.example.mjs`

#### Problema 2 — SuperSplat não tem ferramenta de seleção por cone

O SuperSplat (`supersplat/`) já tem ferramentas de seleção em sua barra inferior:
rect, brush, flood, polygon, lasso, sphere, box, eyedropper. Porém:

- Não existe ferramenta de seleção por **cone** (volume frustum 3D).
- Não existe integração nativa com o bridge server para envio do PLY selecionado.
- O `ToolManager` interno (`supersplat/src/tools/tool-manager.ts`) **não é exposto
  globalmente** — apenas `window.scene` é exposto.

**O SuperSplat renderiza normalmente** quando um arquivo `.ply` é carregado
(drag-drop ou parâmetro `?load=<url>`). O canvas aparece vazio porque nenhum
arquivo está carregado por padrão.

#### Problema 3 — Dois "viewers" concorrentes sem separação clara de papel

O README orienta a usar o SuperSplat como visualizador, mas o `app/` standalone
foi criado como a surface primária do produto (fases 2–5). Essa ambiguidade
causa confusão sobre onde a ferramenta de cone deve viver.

---

### Estratégia de extensão do SuperSplat sem alterar fonte

O SuperSplat expõe `window.scene` em tempo de execução. A partir desse objeto
é possível:

```js
// Acessível pelo console do navegador ou por script injetado
const { events } = window.scene;

// Disparar seleção por esfera em coordenadas de mundo
events.fire('select.bySphere', 'add', [cx, cy, cz, radius]);

// Disparar seleção por box alinhada ao eixo
events.fire('select.byBox', 'set', [cx, cy, cz, lenX, lenY, lenZ]);

// Limpar seleção
events.fire('select.none');

// Acessar dados brutos dos splats
const splat = window.scene.elements[0];        // primeiro GSplat carregado
const x = splat.splatData.getProp('x');        // Float32Array das posições X
const y = splat.splatData.getProp('y');
const z = splat.splatData.getProp('z');
const state = splat.splatData.getProp('state'); // Uint8Array: 0=unselected, 1=selected, 2=deleted
```

Isso abre duas vias de extensão sem alterar `supersplat/src/`:

**Via A — Bookmarklet / snippet de console**

Um script `.mjs` em `tools/cone-selector/inject.mjs` que, quando executado no
contexto da página SuperSplat, injeta um painel flutuante na DOM com controles
de cone e chama `events.fire('select.bySphere', ...)` N vezes ao longo do eixo
do cone para aproximar a seleção cônica.

```
Vantagem : não requer build, funciona com qualquer versão do SuperSplat.
Limitação: aproximação por esferas não é cone exato; número de esferas
           ≈ range / (radius_médio) afeta precisão vs. performance.
```

**Via B — Manipulação direta do array `state` (cone exato)**

Pelo acesso a `splat.splatData.getProp('state')` + `splat.updateState()` é
possível aplicar o predicado de cone exato (mesma função de `select-cone.mjs`)
diretamente nos dados do splat carregado no SuperSplat, sem usar os eventos de
seleção interna.

```js
// Pseudo-código do snippet de console
const splat = window.scene.elements[0];
const x = splat.splatData.getProp('x');
const y = splat.splatData.getProp('y');
const z = splat.splatData.getProp('z');
const state = splat.splatData.getProp('state');

const apex = { x: 0.07, y: 0.25, z: 0.41 };
const axis = { x: -0.22, y: -0.44, z: -0.87 };
const tanA = Math.tan(30 * Math.PI / 180);
const range = 5;

for (let i = 0; i < splat.numSplats; i++) {
    const dx = x[i] - apex.x, dy = y[i] - apex.y, dz = z[i] - apex.z;
    const t = dx * axis.x + dy * axis.y + dz * axis.z;
    if (t > 0 && t < range) {
        const rx = dx - t * axis.x, ry = dy - t * axis.y, rz = dz - t * axis.z;
        if ((rx*rx + ry*ry + rz*rz) < (t * tanA) ** 2) state[i] |= 1; // marca selecionado
    }
}
splat.updateState();              // sobe texture — gaussianas ficam destacadas na UI
window.scene.forceRender = true;
```

> **Verificar** se `splat.updateState()` é método público acessível no build
> produção. Se não for, a alternativa é forçar upload manual:
> `splat.stateTexture.lock()` → modificar → `splat.stateTexture.unlock()`.

**Via C — Página wrapper com iframe (integração ponte)**

Uma página HTML (`tools/cone-selector/index.html`) que:

1. Incorpora SuperSplat em um `<iframe src="http://localhost:3000">`.
2. Adiciona painel de cone na página pai.
3. Usa `contentWindow.window.scene` para executar o snippet da Via B.
4. Após seleção, serializa o PLY das gaussianas selecionadas e envia ao bridge.

```
Vantagem : UI separada, não altera SuperSplat, pode ter painel completo.
Limitação: requer same-origin (iframe SuperSplat servido pelo mesmo host) ou
           que SuperSplat permita cross-origin scripts — verificar CSP do build.
```

---

### Fase 8 — Corrigir renderização GSplat no `app/` standalone

- [x] Reescrever `app/main.mjs` para usar `pc.AppBase` + `pc.AppOptions`.
- [x] Registrar explicitamente `pc.GSplatComponentSystem` e `pc.GSplatHandler`.
- [x] Usar `createGraphicsDevice()` (assíncrono) antes de criar `AppBase`.
- [x] Substituir `app.assets.loadFromUrl` por `Asset` + `app.assets.load` (padrão atual).
- [x] Adicionar câmera de órbita (`camera-controls.mjs`) para facilitar inspeção do splat.
- [x] Adicionar `importmap` em `app/index.html` para resolver o bare specifier `'playcanvas'`.
- [x] Verificar passo a passo:
  ```bash
  npx --yes serve . -p 8080
  # abrir: http://localhost:8080/app/?splat=http://localhost:8080/tools/bridge-server/sample.ply
  # esperado: splat visível no canvas, UI de overlay exibindo "Splat carregado"
  ```

**Commit**: d851842

---

### Fase 9 — Ferramenta de cone no SuperSplat (sem modificar fonte)

- [x] Criar `tools/cone-selector/inject.mjs` com:
  - Painel flutuante com campos: apex, axis, angle, range, op.
  - Predicado de cone exato aplicado em `splatData.getProp('x/y/z/state')`.
  - Suporte a `splat.updateState()` com fallback para `stateTexture` lock/unlock.
  - Botão "Selecionar" → aplica cone e destaca gaussianas na UI do SuperSplat.
  - Botão "Limpar" → remove seleção atual.
  - Botão "Enviar ao Bridge" → serializa PLY binário e POST `/process-mask`.
- [x] Criar `tools/cone-selector/bookmarklet.js` com código do bookmarklet.
- [x] Testar:
  ```
  http://localhost:3000/?load=http://localhost:8080/tools/bridge-server/sample.ply
  # Abrir DevTools → Console → injetar script:
  const s=document.createElement('script');s.type='module';
  s.src='http://localhost:8080/tools/cone-selector/inject.mjs';
  document.head.appendChild(s);
  # Esperado: painel "Cone Selector" aparece no canto superior direito
  ```

**Commit**: ac0b45b

---

### Fase 10 — Página wrapper integrada

- [x] Criar `tools/cone-selector/index.html` com:
  - Layout de duas colunas: sidebar de controle + iframe com SuperSplat.
  - Campo para URL do SuperSplat e URL do splat a carregar (`?load=`).
  - Todos os controles de cone (apex, axis, angle, range, op) no sidebar.
  - Botões Selecionar / Limpar / Enviar ao Bridge.
  - Lógica de acesso a `iframe.contentWindow.scene` (mesmo quando same-origin).
  - Fallback: botão "Injetar Cone Selector" para injeção via DOM do iframe.
  - Campo configurável para Bridge URL.
- [x] Testar em `http://localhost:8080/tools/cone-selector/` com SuperSplat em `http://localhost:3000`.

**Commit**: ver próximo

---

### Fase 11 — Wrapper same-origin para remover injeção manual

**Rollback anchor antes da fase**: `bf2f49b216efe7c845308121d1e788af17b9c74d`

- [x] Validar que o build do SuperSplat em `supersplat/dist/` responde corretamente quando servido pela mesma origem em `http://localhost:8080/supersplat/dist/`.
- [x] Alterar `tools/cone-selector/index.html` para usar `http://localhost:8080/supersplat/dist/` como URL padrão do iframe e do campo `URL SuperSplat`.
- [x] Reabilitar injeção automática do `inject.mjs` quando o iframe estiver same-origin, mantendo fallback claro para URLs cross-origin.
- [x] Testar no navegador: `Abrir com splat` + `Injetar Cone Selector` sem DevTools quando o iframe estiver em `8080/supersplat/dist/`.

**Commit**: 7348648

---

### Fase 12 — Camada unificada de entrada (Gamepad + VR/XR)

> Objetivo: evitar lógica duplicada entre desktop e headset criando uma
> abstração única de ponteiro/raycast para seleção por cone, reaproveitando o
> suporte nativo de gamepad já existente na engine PlayCanvas.

> **Viabilidade**: alta e de baixa a média complexidade. A engine já expõe
> `AppOptions.gamepads`, `pc.GamePads` e o mapeamento de eixos `padrx/padry`
> no controller interno, então o trabalho do produto fica concentrado em:
> inicializar `gamepads` no app, transformar a alavanca direita em cursor/aim
> virtual e mapear botões para `set/add/remove` sem depender de eventos de mouse.

- [x] Criar módulo `app/scripts/input-pointer.mjs` (ou equivalente em `tools/cone-selector/`) com contrato único de entrada:
  - `getPose()` -> `{ origin, direction, sourceType }`
  - `getVirtualCursorDelta()` -> `{ x, y }`
  - `isSelectPressed()` -> boolean
  - `didSelectRelease()` -> boolean
  - `getOperation()` -> `'set' | 'add' | 'remove'`
  - `sourceType` em `{ gamepad, xr-left, xr-right, hmd, keyboard-fallback }`
- [ ] Implementar backend Desktop por gamepad:
  - [x] Inicializar `createOptions.gamepads = new pc.GamePads()` em `app/main.mjs`.
  - [x] Reusar o suporte de eixos da engine para ler a alavanca direita (`PAD_R_STICK_X/Y` ou `padrx/padry`).
  - [x] Converter a alavanca direita em cursor virtual/ray de tela com deadzone, sensibilidade e clamp.
  - [x] Mapear botão 1 para modo `add` e botão 2 para modo `remove`.
  - [x] Definir comportamento padrão sem botão modificador: `set`.
- [ ] Implementar backend XR:
  - [x] Priorizar controlador dominante quando ambos estiverem ativos.
  - [x] Fallback para câmera HMD quando não houver controlador com pose válida.
  - [x] Reusar `inputSource.gamepad` quando disponível para manter o mesmo mapeamento lógico de botões/eixos fora do desktop.
  - [x] Mapear botão 1 para `add` e botão 2 para `remove` também no XR, preservando trigger/select como ação primária quando o perfil não expuser layout padrão.
- [x] Integrar a camada unificada ao seletor atual:
  - [x] Substituir leituras diretas de `this.app.xr` e `keyboard` por chamadas ao adaptador.
  - [x] Preservar comportamento atual de seleção incremental/chunks.
  - [x] Manter compatibilidade com o fluxo atual do bridge.
- [ ] Definir política de prioridade de entrada (estado global):
  - [x] Se sessão XR ativa e controlador válido -> usar XR.
  - [x] Se sessão XR ativa sem controlador mas com `inputSource.gamepad` válido -> usar o layout XR gamepad.
  - [x] Fora de XR com gamepad conectado -> usar cursor virtual por alavanca direita.
  - [x] Sem gamepad -> manter apenas fallback de teclado/câmera para debug.

#### Critérios de aceite da Fase 12

- [ ] Mesmo predicado de cone funciona para gamepad desktop e XR sem divergência geométrica.
- [x] Sem duplicação da lógica de seleção (fonte única).
- [x] Cursor virtual responde à alavanca direita sem depender de eventos capturados pelo SuperSplat.
- [ ] Troca entre gamepad desktop e XR não exige recarregar a página.

---

### Fase 13 — Interação por gamepad no desktop e no modo VR/XR (UX + testes)

> Objetivo: entregar experiência utilizável em desktop e em headset, com
> feedback visual consistente e testes de regressão, sem depender de mouse no
> canvas do SuperSplat.

- [ ] Desktop (gamepad na tela):
  - [x] Alavanca direita move cursor/retículo virtual no canvas.
  - [x] Botão primário confirma `set`; botão 1 ativa `add`; botão 2 ativa `remove`.
  - [x] Overlay de parâmetros em tempo real (`angle`, `range`, `selectedCount`, `mode`, `sourceType`).
  - [x] Ajuste de `coneRange` por eixo secundário ou bumpers, com deadzone e repetição controlada.
- [ ] VR/XR:
  - [x] Ray visual do controlador com cor por modo (`set/add/remove`).
  - [x] Botão 1 = `add`, botão 2 = `remove`, usando o `gamepad` do `XRInputSource` quando disponível.
  - [x] Haptics curtos ao confirmar seleção (quando suportado).
  - [ ] Zona morta e debounce para evitar spam de seleção por trigger/alavanca instáveis.
  - [ ] Mensagem clara quando sessão XR não possui input source ou layout de gamepad utilizável.
- [ ] Wrapper `tools/cone-selector/index.html`:
  - [x] Botão explícito de modo de entrada: `Auto | Gamepad | XR`.
  - [x] Indicador de fonte ativa (`gamepad`, `xr-left`, `xr-right`, `hmd`).
  - [ ] Comando `serializeFull` exposto na UI com parâmetros:
    - `selectedOpacityRaw`
    - `unselectedOpacityRaw`
    - `opacityThresholdRaw`
- [ ] Testes automatizados:
  - [x] `test:input-pointer` (mock de gamepad/xr e transição de estados).
  - [x] `test:virtual-cursor` (deadzone, clamp e mapeamento da alavanca direita).
  - [x] `test:cone-projection` (consistência do raio entre gamepad desktop e XR).
  - [x] `test:bridge-opacity-flow` (pipeline `SELECT -> MASK(-V opacity_raw,gt,T) -> EXPORT`).
- [ ] Testes manuais (checklist):
  - [x] Desktop com gamepad: selecionar, limpar e enviar ao bridge.
  - [ ] XR com 1 controlador: seleção contínua e envio ao bridge.
  - [ ] XR com 2 controladores: prioridade do dominante.
  - [ ] Queda de controlador em runtime: fallback para HMD/câmera sem travar.

#### Critérios de aceite da Fase 13

- [ ] Fluxo desktop com gamepad e fluxo XR produzem saída válida no bridge (`ok: true`, `outputBytes > 0`).
- [ ] Não há regressão no modo legado de serialização.
- [ ] README atualizado com seção de operação por gamepad e por XR.

---

### Fase 14 — Rendering XR/VR no Cone Selector (Wrapper + Inject)

> Objetivo: incorporar inicialização/encerramento de sessão XR diretamente no
> fluxo do `tools/cone-selector/`, mantendo o SuperSplat sem alteração de fonte
> e seguindo o padrão sugerido em `vrxr_input.md` (start por interação de UI,
> verificação de disponibilidade e câmera válida).

- [x] `tools/cone-selector/inject.mjs`:
  - [x] Expor RPC `xrStatus` para consultar `supported`, `availableVr` e `active`.
  - [x] Expor RPC `xrStart` com `{ type: 'immersive-vr', space: 'local-floor' }`.
  - [x] Expor RPC `xrEnd` e `xrToggle` para controle de ciclo da sessão.
  - [x] Resolver câmera de forma robusta (`scene.camera`, `cameraEntity` ou `root.findComponents('camera')`).
  - [x] Retornar erros claros quando WebXR não estiver disponível.
- [x] `tools/cone-selector/index.html`:
  - [x] Adicionar botões de UI: `Entrar em XR (VR)`, `Sair do XR`, `Alternar XR`.
  - [x] Adicionar atalho de teclado `V` para alternar sessão XR.
  - [x] Adicionar indicador de fonte ativa no sidebar (`auto | gamepad | xr`).
  - [x] Sincronizar status XR periodicamente via `postMessage` RPC.

#### Critérios de aceite da Fase 14

- [ ] Em navegador compatível + headset conectado, iniciar XR via botão sem abrir DevTools.
- [ ] Encerrar XR sem recarregar iframe nem perder estado da UI do cone selector.
- [ ] Quando XR indisponível, exibir mensagem de erro clara no status do wrapper.

---

### Fase 15 — Build custom do SuperSplat com XR habilitado

> Objetivo: remover o bloqueio estrutural de XR no runtime do SuperSplat usado
> no iframe do wrapper, mantendo o injector atual e habilitando a sessão VR no
> próprio `window.scene.app`.

- [x] Alterar `supersplat/src/main.ts` para criar `GraphicsDevice` com `xrCompatible: true`.
- [x] Alterar `supersplat/src/pc-app.ts` para habilitar `appOptions.xr = XrManager`.
- [x] Rebuildar distribuição do SuperSplat:
  ```bash
  cd supersplat
  npm run build
  ```
- [x] Manter compatibilidade com o injector atual (`tools/cone-selector/inject.mjs`) sem remover fallback.

#### Critérios de aceite da Fase 15

- [x] `window.scene.app.xr` disponível no build custom do SuperSplat.
- [ ] Fluxo de `xrStart` no wrapper válido com headset conectado e permissão concedida.
- [x] Fluxo fallback para app standalone permanece funcional quando XR não estiver disponível no navegador/dispositivo.

---

### Fase 16 — Estabilização XR (Grid, Pipeline e Input)

> Objetivo: consolidar a experiência XR para que a mesma cena do SuperSplat
> seja renderizada no headset com controles equivalentes ao gamepad desktop,
> reduzindo discrepâncias entre runtime desktop e VR.

- [x] Corrigir pipeline XR para evitar black screen após transição desktop → XR.
  - Ajuste no render path para manter passes necessários de splat/composição durante XR.
- [x] Manter render contínuo durante sessão XR para acompanhar pose de cabeça/controlador.
- [x] Corrigir grid no XR para seguir a câmera/olho ativo (evitar grid “fixo” em world-space indevido).
- [x] Ajustar mapeamento de botões/eixos XR para ficar mais próximo do comportamento de gamepad.
- [x] Habilitar `xrCompatible` + `XrManager` também no app standalone (`app/`) para botão VR.
- [x] Mitigar cache stale via Service Worker no fluxo local (`nosw=1` e unregister em localhost).

#### Critérios de aceite da Fase 16

- [x] Entrar em XR não apaga a cena imediatamente após o primeiro frame.
- [x] Grid do SuperSplat acompanha corretamente a câmera XR.
- [ ] Controles XR reproduzem integralmente as ações esperadas de gamepad em todos os perfis de headset/controlador.
- [ ] Botão VR do app standalone entra em sessão XR em ambiente WebXR válido sem ações extras.

---

## Pausa Técnica — Estado Atual

### Resumo do que já foi feito

- Wrapper de cone com controle de sessão XR (`xrStart`, `xrEnd`, `xrToggle`) via `postMessage`.
- Build custom do SuperSplat com suporte XR habilitado.
- Correções de render XR (pipeline, render contínuo, grid no XR).
- Correções de input unificado (gamepad + XR) e feedback visual do cone.
- Fluxo local com bypass de Service Worker para evitar bundle antigo durante iteração.

### Problemas ainda em aberto

- Comportamento de controles XR ainda pode variar por perfil de headset/controlador.
- Botão VR no app standalone pode depender de condições de runtime (OpenXR/SteamVR/browser/gesto do usuário) mesmo com código ajustado.

### Próximos passos recomendados

1. Rodar matriz de testes por headset/controlador (Quest Link, Index, WMR) com log de mapeamento de botões/eixos.
2. Adicionar telemetria em overlay para `sourceType`, `buttons`, `axes`, `xr.active`, `xr.type`, `xr.spaceType`.
3. Congelar mapeamento por perfil de device (fallback em cadeia) e documentar no README.
4. Fechar checklist manual de Fase 13/14/16 e promover critérios pendentes para concluídos.

---

## Guia Rápido — Como entrar em VR/XR pela interface

### Pré-requisitos

- Headset conectado e reconhecido pelo runtime WebXR.
- SteamVR ativo (quando aplicável) e runtime OpenXR configurado.
- Página servida em `localhost` (ou HTTPS) para permissões WebXR.

### Fluxo pelo wrapper (`tools/cone-selector/`)

1. Abrir: `http://localhost:8080/tools/cone-selector/`
2. Confirmar URL do SuperSplat no campo lateral (preferencialmente com `?nosw=1`).
3. Clicar em **Abrir com splat**.
4. Clicar em **Injetar Cone Selector** (se ainda não estiver ativo).
5. Definir modo em **XR** e clicar em **Entrar em XR (VR)**.
6. Para sair, usar **Sair do XR** (ou **Alternar XR** / tecla `V`).

### Fluxo pelo app standalone (`app/`)

1. Abrir: `http://localhost:8080/app/?splat=http://localhost:8080/tools/bridge-server/sample.ply`
2. Clicar em **Entrar em VR**.
3. Se não iniciar, validar disponibilidade no runtime WebXR (browser + OpenXR/SteamVR + permissões).

---

## Referências

- Engine GSplat API: https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/
- Script system: https://developer.playcanvas.com/user-manual/scripting/
- Exemplo shader-effects: `engine/examples/src/examples/gaussian-splatting/shader-effects.example.mjs`
- Multi-splat vertex shader: `engine/examples/src/examples/gaussian-splatting/multi-splat.shader.glsl.vert`
- Engine gamepad input: `engine/src/platform/input/game-pads.js`, `engine/src/platform/input/controller.js`
- XR controllers script: `engine/scripts/esm/xr-controllers.mjs`
- PlayCanvas Editor: https://github.com/playcanvas/editor
- SuperSplat `window.scene` API (inferida do código): `supersplat/src/scene.ts`, `supersplat/src/splat.ts`
- `pc.AppBase` exemplo oficial: `engine/examples/src/examples/gaussian-splatting/simple.example.mjs`