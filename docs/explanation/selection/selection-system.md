# `selection/selection-system.mjs` — máscara por-splat, brush, clear/invert

**Arquivo:** `src/selection/selection-system.mjs`
**Papel:** o coração da seleção. Cria os splats **selecionáveis**, anexa os streams
de instância extras, executa o brush (via `GSplatProcessor`), e gerencia
clear/invert, realce, labels e visibilidade.

Voltar ao índice: [[README]] · Criado por: [[main]] ·
Shader visual: [[workbuffer-modifier]] · Input: [[brush-input]] / [[xr-session]] ·
Consome edições de: [[edit-system]] · Exporta via: [[ply-exporter]]
Pré-requisitos de baixo nível: [[concepts]] §3 (streams/`splat.uv`/formatos),
§4 (lock vs read), §7 (blend MAX/MIN)

---

## Conceito-chave

O "pincel" **não pinta**: ele marca uma **máscara de seleção por-splat**
(`selectionMask`, formato `R8`: 255 = selecionado, 0 = não). Um `GSplatProcessor`
por entidade escreve essa máscara na GPU para os splats dentro da esfera do pincel.

---

## O shader de processamento (`selectionShader`, linhas 21–61)

Roda no `GSplatProcessor`. Em **espaço-mundo**, testa a posição **editada** de cada
splat contra a esfera do pincel:

```glsl
void process() {
    vec3 baseWorld = (uModelMatrix * vec4(getCenter(), 1.0)).xyz;   // base → mundo
    vec4 q  = texelFetch(editQuat, splat.uv, 0);
    vec4 ts = texelFetch(editTS,  splat.uv, 0);
    vec3 world = ts.xyz + ts.w * sp_rotq(q, baseWorld);             // aplica edição commitada
    float inside = step(distance(world, uBrushSphere.xyz), uBrushSphere.w);
    float v = mix(1.0 - inside, inside, step(0.5, uSelMode));       // aditivo vs subtrativo
    writeSelectionMask(vec4(v));
}
```

> Por testar a posição **editada** (mesma fórmula `t + s·rot(q, base)` de
> [[workbuffer-modifier]]), re-selecionar acerta os splats **onde eles estão agora**,
> não na posição original.

`getCenter()` e `writeSelectionMask()` são funções fornecidas pela engine ao
processor (ver "GSplatProcessor" abaixo). `uModelMatrix`, `uBrushSphere`, `uSelMode`
são uniforms setados em `processPending`.

---

## Como o `GSplatProcessor` funciona (engine)

O processor faz GPU compute lendo *streams* de origem e escrevendo *streams* de
destino. Do JSDoc da engine (`framework/gsplat/gsplat-processor.js`):

```js
// GSplatProcessor enables GPU-based processing of Gaussian Splat data using custom shader code.
// ... reads from source streams and writes results to destination streams,
// enabling operations like painting, selection marking, or custom data transforms.
//
// Quando as streams de origem não são especificadas, o processor fornece
// getCenter(), getRotation(), getScale(), getColor() para ler os dados do splat.
// Nota: getCenter() deve ser chamado primeiro (carrega dados compartilhados).
```

Construção (linhas 158–163):
```js
const processor = new pc.GSplatProcessor(
    device,
    { component: gsplatComponent },                          // origem: todas as streams
    { component: gsplatComponent, streams: ['selectionMask'] }, // destino: só a máscara
    selectionShader
);
```
A engine exige que **origem e destino não compartilhem stream** (não dá para ler e
escrever a mesma stream num passe) — daí a técnica de blend para acúmulo (abaixo).

---

## Acúmulo aditivo/subtrativo via blend (linhas 71–72)

Como o processor **não pode ler+escrever** `selectionMask` no mesmo passe, o acúmulo
usa **equações de blend** em vez de leitura prévia:

```js
const additiveBlend    = new pc.BlendState(true, pc.BLENDEQUATION_MAX, ...); // escreve 1 dentro
const subtractiveBlend = new pc.BlendState(true, pc.BLENDEQUATION_MIN, ...); // escreve 0 dentro
```
- **Aditivo** → `MAX`: dentro da esfera escreve 1, fora 0; `max(antigo, novo)` mantém
  o que já estava selecionado.
- **Subtrativo** → `MIN`: dentro escreve 0, fora 1; `min(antigo, novo)` só desmarca
  o interior.

> Detalhamento das equações de blend (por que `MAX`/`MIN` ignoram os fatores
> `ONE/ONE` e como isso evita o readback): [[concepts]] §7.

---

## Criação de um splat selecionável (`createSelectableSplat`, linhas 133–209)

1. **Entidade gsplat** (linhas 134–139): cria `pc.Entity`, adiciona componente
   `gsplat` com `unified: true` (modo necessário para streams de instância) e aplica
   posição/rotação/escala.
2. **Streams extras** (linhas 142–155): via `ensureStream` + `addExtraStreams`.
   Do JSDoc da engine:
   ```js
   resource.format.addExtraStreams([
       { name: 'instanceTint', format: pc.PIXELFORMAT_RGBA8, storage: pc.GSPLAT_STREAM_INSTANCE }
   ]);
   const texture = entity.gsplat.getInstanceTexture('instanceTint');
   ```
   Aqui adiciona: `selectionMask` (R8), `splatLabel` (R8), `editQuat` (RGBA32F),
   `editTS` (RGBA32F), `editColor` (RGBA8). `GSPLAT_STREAM_INSTANCE` = uma textura
   **por componente/entidade** (não compartilhada com outras instâncias do asset).
3. **Processor** (linhas 158–163): como descrito acima.
4. **Inicialização das texturas** (linhas 166–186): `lock()`/`unlock()` para
   preencher valores iniciais —
   - `selectionMask` = 0 (nada selecionado);
   - `editQuat` = identidade `(0,0,0,1)`, `editTS` = `(0,0,0,1)` (escala 1) →
     o [[workbuffer-modifier]] vira *pass-through* até existir edição;
   - `editColor` = 0 (sem override).
5. **Instala o modifier** (linhas 188–193):
   ```js
   gsplatComponent.setWorkBufferModifier(workBufferModifier);
   gsplatComponent.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;
   ```
   `WORKBUFFER_UPDATE_ONCE` força um update neste frame e volta a AUTO. Do JSDoc da
   engine:
   ```
   WORKBUFFER_UPDATE_ONCE:   força update neste frame, depois volta a AUTO.
   WORKBUFFER_UPDATE_ALWAYS: update todo frame (impacto de performance).
   ```
6. **Uniforms default** (linhas 196–204): zera os `uActive*` e aplica os parâmetros
   de label/realce iniciais.
7. **Registro** (linhas 206–207): guarda `{ entity, gsplatComponent, processor,
   maxLabel, numSplats, resource }` em `selectables` (lido por [[edit-system]] e
   [[ply-exporter]]).

### Labels do PLY (`initializeLabelTextureFromPly`, linhas 114–131)
Lê a propriedade `label` do `gsplatData` (se existir) e copia para a textura
`splatLabel`, retornando o maior rótulo (`maxLabel`) para normalizar as cores no
[[workbuffer-modifier]] (`uLabelMax`).

---

## Brush: fila e processamento (linhas 211–232)

A seleção é **enfileirada** e processada uma vez por frame:
```js
const queueSelect = (worldPoint, radius, mode) => pending.push({ ... });   // chamado por input

const processPending = () => {                                              // chamado em main no update
    while (pending.length > 0) {
        const { worldPoint, radius, mode } = pending.shift();
        for (const s of selectables) {
            if (!s.entity.enabled) continue;
            s.processor.setParameter('uBrushSphere', [x, y, z, radius]);
            s.processor.setParameter('uSelMode', mode);
            s.processor.setParameter('uModelMatrix', s.entity.getWorldTransform().data);
            s.processor.blendState = mode === SELECT_ADDITIVE ? additiveBlend : subtractiveBlend;
            s.processor.process();                                          // executa o GPU pass
            s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;   // re-renderiza com a nova máscara
        }
    }
};
```
> Enfileirar evita disparar múltiplos passes de GPU por evento de mouse/raio; tudo é
> consumido no `app.on('update')` de [[main]].

**O que `processor.process()` faz por dentro** (engine, `gsplat-processor.js`): é um
**render pass de quad** (um fragment shader que cobre a textura de destino, um
fragmento por splat). Ele liga as texturas-fonte, expõe uniforms automáticos
(`splatTextureSize`, `dstTextureSize`, `srcNumSplats`, `dstNumSplats`), aplica os
parâmetros setados via `setParameter`, define `renderPass.blendState = this.blendState`
e renderiza. As funções `getCenter()`/`writeSelectionMask()` do shader são geradas a
partir das streams de origem/destino. Ver [[concepts]] §2 (o processor é um passe
**separado** do work buffer).

`SELECT_ADDITIVE = 1` / `SELECT_SUBTRACTIVE = 0` (linhas 63–64) são exportados e
usados por [[brush-input]] e [[xr-session]].

---

## Operações sobre a máscara

- **`clear()`** (linhas 235–244): `lock()` → `fill(0)` → `unlock()` (zera tudo).
- **`invert()`** (linhas 246–258): faz **readback** (`tex.read(...)`), inverte cada
  valor (`>127 ? 0 : 255`) e reescreve. É `async` por causa do readback de GPU
  (GPU→CPU; ver [[concepts]] §4 — `read()` retorna `Promise`). Diferente de `clear`,
  precisa do estado atual, então não dá para fazer só com `lock`/`fill`.

## Sincronização de parâmetros
- **`updateHighlight()`** (linhas 261–264): reaplica `uSelHighlightColor/Strength` a
  todos os selectables (ligado a `selectionColor:set`/`selectionStrength:set` em [[main]]).
- **`syncLabelViewer()`** (linhas 266–269): reaplica os uniforms `uLabel*`.

## Visibilidade de assets (linhas 74–96)
`registerVisibilityItem` cria uma chave `showAsset_<nome>` no [[observer]], adiciona
um item em `assetVisibilityItems` (que [[controls]] renderiza como checkbox) e
escuta `:set` para ligar/desligar `entity.enabled` via `syncAssetVisibility`.

## API retornada
`{ selectables, createSelectableSplat, registerVisibilityItem, syncAssetVisibility,
queueSelect, processPending, beginStroke, endStroke, clear, invert, hideSelected,
updateHighlight, syncLabelViewer, destroy }`.

## Atualizações (sessão atual)

- **Escopo por objeto:** `processPending` só roda o processor na entidade cujo nome bate
  com `activeSelectionTarget` ('all' = todas) — o pincel ignora interseções com outros objetos.
- **Stream `hidden`** (R8, default 0): criado em cada selecionável; `hideSelected()` marca 255
  nos splats da máscara → o [[workbuffer-modifier]] os deixa transparentes (usado por [[retexture]]).
- **Undo de seleção** ([[history]]): `clear`/`invert` e cada **pincelada** (`beginStroke`/
  `endStroke`) tiram *snapshots* da máscara (antes/depois) e empilham um comando que
  faz upload do estado correspondente. As bordas de pincelada vêm de [[brush-input]] (mouse)
  e [[xr-session]] (gatilho).
