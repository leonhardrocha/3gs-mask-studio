# `config.mjs` — configuração do app

**Arquivo:** `src/config.mjs`
**Papel:** fornece `rootPath` (base das URLs de assets) e `deviceType` (qual API
gráfica usar). Substitui os helpers `examples/utils` do navegador de exemplos
original do PlayCanvas.

Voltar ao índice: [[README]] · Usado por: [[main]]

---

## Passo a passo

### 1. `rootPath` (linha 13)

```js
export const rootPath = '';
```

- Base usada para montar URLs de assets. Os assets vivem em `public/static/...`,
  que o Vite serve a partir da **raiz do site**, então a base é vazia.
- Exemplo de uso em [[main]]:
  `${rootPath}/static/assets/splats/biker.compressed.ply`.

### 2. Lista de devices permitidos (linha 22)

```js
const DEVICE_TYPES = ['webgpu', 'webgl2', 'null'];
```

Os três valores aceitos: WebGPU, WebGL2 e o device `null` (sem render, útil para
testes).

### 3. Leitura do query string (linha 23)

```js
const requested = new URLSearchParams(window.location.search).get('device');
```

Lê `?device=...` da URL. Ex.: abrir `index.html?device=webgpu` pede WebGPU.

### 4. `deviceType` com fallback (linha 24)

```js
export const deviceType = DEVICE_TYPES.includes(requested) ? requested : 'webgl2';
```

- Se o valor pedido for válido, usa-o; senão, **WebGL2 por padrão**.
- **Por que WebGL2 por padrão?** Conforme os comentários do arquivo e a
  `ARCHITECTURE.md` §8:
  - O *snap* de superfície usa `pc.Picker.getWorldPointAsync`, que é **WebGL-only**
    (ver [[brush-input]]).
  - O Quest (alvo de XR) roda WebGL.
  - WebGPU é *opt-in* e desbloqueia o renderer de compute do GSplat e os caminhos WGSL.

---

## Conexões

- `deviceType` é consumido em [[main]] ao criar o `GraphicsDevice`:
  `pc.createGraphicsDevice(canvas, { deviceTypes: [deviceType], ... })`.
- O `deviceType` também determina **qual variante de shader** a engine compila
  (GLSL para WebGL2, WGSL para WebGPU) — relevante para [[workbuffer-modifier]] e
  [[selection-system]], que mantêm as duas versões em paralelo.
