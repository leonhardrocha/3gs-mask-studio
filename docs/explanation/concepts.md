# Conceitos de baixo nível (referência transversal)

Esta nota reúne os conceitos compartilhados por vários arquivos, para não repetir a
explicação em cada um. Os docs por-arquivo apontam para as seções daqui.

Voltar ao índice: [[README]]
Referenciada por: [[workbuffer-modifier]] · [[selection-system]] · [[edit-system]] ·
[[ply-exporter]] · [[brush-input]]

---

## 1. O que é um Gaussian Splat (e como a engine o guarda)

Um *splat* é uma **gaussiana 3D anisotrópica** descrita por:
- **centro** `(x, y, z)` — posição;
- **rotação** — quaternion `(x, y, z, w)` que orienta os eixos da elipsoide;
- **escala** `(sx, sy, sz)` — comprimento dos 3 semieixos, **armazenada em log**
  (ver §6);
- **cor** — coeficientes de harmônicos esféricos (SH); a banda 0 (`f_dc_*`) é a cor
  "base" (ver §5);
- **opacidade**.

Na engine, esses atributos **não** vivem em arrays JS: cada um é uma **textura na
GPU** com um texel por splat. O conjunto de texturas de um asset é o seu *format*
(streams). Ver §3.

---

## 2. O pipeline GSplat unificado e o "work buffer"

Com `unified: true`, a engine renderiza os splats em etapas (por frame, quando
necessário):

```
texturas-fonte do asset (centro/rot/escala/cor/SH + streams extras)
        │
        ▼  passe "copy to work buffer"  ← aqui roda o MODIFIER ([[workbuffer-modifier]])
   WORK BUFFER  (cópia processada dos splats, já em espaço-mundo)
        │
        ▼  ordenação por profundidade (back-to-front)
        │
        ▼  rasterização (blend alpha) → imagem final
```

- O **work buffer** é uma representação intermediária: a engine copia cada splat
  para ele aplicando o *modifier* (posição/rotação/escala/cor editadas). A ordenação
  e a rasterização trabalham sobre o work buffer, não sobre as texturas originais.
- **Por que isso importa para performance:** reconstruir o work buffer é caro
  (percorre todos os splats; no VR é feito 2× por causa do estéreo). Por isso o app
  usa `workBufferUpdate = WORKBUFFER_UPDATE_ONCE` **só quando algo muda**, em vez de
  `WORKBUFFER_UPDATE_ALWAYS`. Constantes (JSDoc da engine):
  ```
  WORKBUFFER_UPDATE_AUTO:   atualiza só quando necessário (default).
  WORKBUFFER_UPDATE_ONCE:   força update neste frame, depois volta a AUTO.
  WORKBUFFER_UPDATE_ALWAYS: update todo frame (impacto de performance).
  ```
- O **`GSplatProcessor`** ([[selection-system]]) é um passe **separado** do work
  buffer: ele lê as texturas-fonte e escreve numa *stream* de destino
  (`selectionMask`). Internamente é um *render pass de quad* (um fragment shader que
  cobre a textura de destino), com `blendState` aplicável (ver §7).

---

## 3. Streams de instância: layout de textura e `splat.uv`

Streams extras são adicionadas com `format.addExtraStreams([{ name, format,
storage: GSPLAT_STREAM_INSTANCE }])`. `GSPLAT_STREAM_INSTANCE` = textura **por
componente/entidade** (cada selectable tem a sua; não é compartilhada entre
instâncias do mesmo asset).

**Layout:** a textura é 2D (largura `w`, altura `h`), mas os splats são indexados
linearmente `i = 0..n-1`. O mapeamento é:
```
splat.uv = ( i % w , floor(i / w) )
```
No shader, `texelFetch(stream, splat.uv, 0)` (GLSL) / `textureLoad(stream, splat.uv,
0)` (WGSL) lê o texel do splat atual. Os arrays CPU (mirror em [[edit-system]],
máscara) usam o índice **linear** `i`; texturas RGBA usam `k = i*4` (4 canais).

**Formatos usados no app:**
| Formato | Bytes/texel | Uso |
|---|---|---|
| `PIXELFORMAT_R8` | 1 (uint 0–255) | `selectionMask`, `splatLabel` |
| `PIXELFORMAT_RGBA8` | 4 (uint 0–255) | `editColor` (rgb + flag) |
| `PIXELFORMAT_RGBA32F` | 16 (float) | `editQuat`, `editTS` |

---

## 4. Escrever vs ler uma textura na GPU

Há **três** caminhos, com custos bem diferentes:

| Operação | Direção | Custo | Onde aparece |
|---|---|---|---|
| `tex.lock()` → escreve no array → `tex.unlock()` | CPU → GPU | barato | init/clear/invert/uploadMirror |
| `await tex.read(x,y,w,h)` | GPU → CPU (**readback**) | caro/assíncrono | commit, recomputePivot, invert, export |
| shader `texelFetch`/`writeXxx` | dentro da GPU | barato | modifier, processor |

- **`lock()`** devolve o array tipado do *staging* da textura; você escreve e
  `unlock()` faz o upload. O tipo do array casa com o formato (Uint8Array para R8/RGBA8,
  Float32Array para RGBA32F).
- **`read()`** baixa pixels da GPU para a CPU e **retorna uma `Promise`** (JSDoc da
  engine: *"A promise that resolves with the pixel data"*). É por isso que `invert`,
  `commit`, `recomputePivot` e o export são `async` e usam `await`. Readback estola
  o pipeline, então é feito sob demanda (em ações do usuário), nunca por frame.

---

## 5. Cor: harmônicos esféricos e o termo DC

A cor de um splat é *view-dependent*, codificada em **harmônicos esféricos (SH)**. O
coeficiente de **banda 0** (`f_dc_0..2`, um por canal RGB) é o termo **DC** (constante
em todas as direções) — a "cor base". As bandas superiores (`f_rest_*`) acrescentam
variação direcional (brilho especular etc.).

Conversão entre o `f_dc` e a cor RGB linear (0–1):
```
cor   = 0.5 + SH_C0 · f_dc
f_dc  = (cor − 0.5) / SH_C0
SH_C0 = 0.5 · sqrt(1/π) ≈ 0.28209479177387814
```
- `SH_C0` é o valor da função SH de grau 0 (constante).
- O **+0.5** centra o intervalo (cinza neutro quando `f_dc = 0`).

É exatamente a fórmula usada em [[ply-exporter]] para gravar um *override* de cor:
`f_dc = (rgb − 0.5)/SH_C0`. O exportador grava **apenas o DC**; as bandas superiores
são descartadas (limitação documentada — `ARCHITECTURE.md` §10).

---

## 6. Escala em espaço log

A escala dos semieixos é guardada como **logaritmo natural** (`scale_n = ln(σ_n)`).
A engine ativa com `exp()` ao renderizar. Guardar em log dá precisão em ordens de
grandeza e torna **multiplicações** de escala em **somas**:
```
σ_final = entityScale · exp(scaleLog) · sEdit
ln(σ_final) = ln(entityScale) + scaleLog + ln(sEdit)
```
Daí a linha do [[ply-exporter]]:
```js
out = (scale_n) + log(entityScale_n) + log(sEdit);
```

---

## 7. Acúmulo por equação de blend (MAX / MIN)

O `GSplatProcessor` **não pode ler e escrever a mesma stream** num passe. Para
acumular a seleção sem readback, [[selection-system]] usa **equações de blend**:

```js
new pc.BlendState(true, pc.BLENDEQUATION_MAX, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE); // aditivo
new pc.BlendState(true, pc.BLENDEQUATION_MIN, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE); // subtrativo
```
- A **equação** define como o valor novo (`src`) combina com o que já está no
  destino (`dst`). `MAX`/`MIN` ignoram os fatores (`ONE`/`ONE`) e fazem
  `max(dst, src)` / `min(dst, src)`.
- **Aditivo (MAX):** escreve 1 dentro da esfera, 0 fora → `max(antigo, 1) = 1`
  (marca) e `max(antigo, 0) = antigo` (preserva fora).
- **Subtrativo (MIN):** escreve 0 dentro, 1 fora → `min(antigo, 0) = 0` (desmarca) e
  `min(antigo, 1) = antigo` (preserva fora).

`process()` aplica `this._renderPass.blendState = this.blendState` antes de renderizar.

---

## 8. Quaternions: rotação e composição

Duas operações aparecem na GPU ([[workbuffer-modifier]], [[selection-system]]) e na
CPU ([[edit-system]], [[ply-exporter]]):

**Rotacionar um vetor `v` por `q`** (forma otimizada, evita montar matriz):
```glsl
vec3 sp_rotq(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
```
É a expansão de `v' = q · v · q⁻¹` para quaternion unitário. Na CPU, o equivalente é
`pc.Quat.transformVector`.

**Compor duas rotações** (`a` depois aplica-se sobre `b`):
```glsl
vec4 sp_qmul(vec4 a, vec4 b) {
    return vec4(a.w*b.xyz + b.w*a.xyz + cross(a.xyz, b.xyz),
                a.w*b.w - dot(a.xyz, b.xyz));
}
```
Produto de Hamilton. Na CPU, `pc.Quat.mul2(a, b)`. **Ordem importa**: `a ⊗ b ≠ b ⊗ a`.
Em [[edit-system]] o commit faz `q' = Ra ⊗ q` (a nova rotação à esquerda).

### Transformação de **similaridade** por-splat
A edição armazenada é uma similaridade (rotação + escala uniforme + translação):
```
editado = t + s · rot(q, base)
```
Restringir a escala a **uniforme** (um único `s`, não `sx,sy,sz`) é o que mantém a
composição fechada: compor duas similaridades dá outra similaridade. Escala
não-uniforme exigiria carregar uma matriz por splat e quebraria o `q' = Ra ⊗ q`.
A composição completa usada no commit:
```
q' = Ra ⊗ q
s' = sa · s
t' = P + sa · Ra·(t − P) + ta        (P = pivô)
```
