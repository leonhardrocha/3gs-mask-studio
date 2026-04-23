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

- [ ] Round-trip validado: seleção VR → PLY exportado → bridge → `splat-transform` → artefato.
- [ ] Testes: `cone-math`, `ply-exporter`, `round-trip` em `tools/bridge-server`.

### Fase 5 — Performance

- [ ] Seleção incremental (chunks) para evitar stutter em VR (> 1M gaussianas).
- [ ] Web Worker opcional para sorting/seleção fora da thread de renderização.

---

## Referências

- Engine GSplat API: https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/
- Script system: https://developer.playcanvas.com/user-manual/scripting/
- Exemplo shader-effects: `engine/examples/src/examples/gaussian-splatting/shader-effects.example.mjs`
- Multi-splat vertex shader: `engine/examples/src/examples/gaussian-splatting/multi-splat.shader.glsl.vert`
- XR controllers script: `engine/scripts/esm/xr-controllers.mjs`
- PlayCanvas Editor: https://github.com/playcanvas/editor