# `src/selection/splat-index.mjs` — índice espacial p/ snap em XR

Índice espacial em **CPU** (grade hash) sobre os centros **editados** dos splats, com
ray-march para responder ao snap de superfície em XR. Substitui o `pc.Picker` (readback
GPU → hitch, WebGL-only) por uma query sem readback, que funciona em WebGL e WebGPU.

> Conceitos: [[concepts]] · consumidor: [[xr-session]] · alternativa desktop: [[brush-input]] (Picker).

## Por que não o Picker em XR

O `Picker.getWorldPointAsync` faz readback de profundidade da GPU — a 72–90 Hz em estéreo
isso causa engasgo e atraso. O índice em CPU consulta na thread principal (~7 µs/raio a 1M),
sem readback, e escopa naturalmente por objeto.

## Núcleo puro (testável em Node)

`buildGrid(positions, count, { cellSize })` e `raycastGrid(grid, origin, dir, beamRadius,
maxDist)` não importam `pc` — só `Float32Array`/números. Testados em
`scripts/test-splat-index.mjs` (acerto, miss, front-most, beam, jitter).

- **`buildGrid`** — AABB → `cellSize` (idealmente ≈ raio do beam de snap) → buckets por
  célula num `Map` com **chave numérica composta** `(ix*ny+iy)*nz+iz` (sem colisão).
- **`raycastGrid`** — marcha o raio pela grade (clip no AABB + passos de `cellSize`),
  testa os splats na vizinhança `nr = ceil(beamRadius/cellSize)` (capada), e retorna o
  **`t` (profundidade no raio)** do splat front-most dentro do beam, ou -1.

> **Lição de design:** `cellSize` deve ≈ `beamRadius`; senão `nr` explode (vizinhança
> O(nr³)) e a query trava em distribuições planas/densas.

## Camada de engine

`createSplatIndex({ system, data })` extrai os centros **mundo+edição** dos selecionáveis
do escopo (matemática inline, sem `pc`), constrói o grid com `cellSize = snapBeamRadius`, e
expõe `raycast(origin, dir)`. Marca *dirty* (rebuild lazy) em `commitEdit`, troca de
`activeSelectionTarget` e mudança de `snapBeamRadius`.

## Feel (em [[xr-session]])

A lateral fica **1:1 no raio**; só a **profundidade** é snapada e então suavizada (τ≈0.05 s)
com **gate de saltos** (>0.4 m precisam persistir alguns frames) e *hold* da última
profundidade em dropout. Diagnóstico (`depth/jitter/dropout`) vai para `data.snapStats` (HUD).
