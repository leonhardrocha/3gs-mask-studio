# `workbuffer-modifier.mjs` — o shader central (realce + edições + labels)

**Arquivo:** `src/workbuffer-modifier.mjs`
**Papel:** exporta um objeto `{ glsl, wgsl }` com código de shader injetado pela
engine no passe **"copy to work buffer"**. É o que torna visíveis as edições, o
realce da seleção e o visualizador de labels.

Voltar ao índice: [[README]] · Instalado por: [[selection-system]] ·
Uniforms vêm de: [[edit-system]] e [[selection-system]]
Pré-requisitos de baixo nível: [[concepts]] §2 (work buffer), §3 (streams/`splat.uv`),
§8 (quaternions)

---

## Como a engine usa este objeto

[[selection-system]] chama `gsplatComponent.setWorkBufferModifier(workBufferModifier)`.
A engine escolhe **GLSL ou WGSL** conforme o device e injeta o código no shader que
copia cada splat para o *work buffer* (a representação intermediária usada na
rasterização/ordenação). Trecho da engine (`framework/components/gsplat/component.js`):

```js
setWorkBufferModifier(value) {
    if (value) {
        const device = this.system.app.graphicsDevice;
        const code = (device.isWebGPU ? value.wgsl : value.glsl) ?? null;  // escolhe a variante
        this._workBufferModifier = code ? { code, hash: hashCode(code) } : null;
    }
    ...
}
```

A engine espera que o código forneça **exatamente três funções** (do JSDoc da engine):

```js
// modifySplatCenter:        modifica a posição do centro do splat
// modifySplatRotationScale: modifica rotação e escala
// modifySplatColor:         modifica a cor
```

> Importante: o modifier roda em **espaço-mundo**, **uma vez por splat**, e só é
> reexecutado quando `workBufferUpdate` está em `WORKBUFFER_UPDATE_ONCE` (ver
> [[selection-system]] e a `ARCHITECTURE.md` §4). Por isso cada mudança de UI
> dispara um `WORKBUFFER_UPDATE_ONCE` em vez de `ALWAYS` (que rerenderizaria todo
> frame — o principal custo no estéreo do VR).

---

## Streams de instância lidos via `texelFetch`

O shader lê dados por-splat (escritos pela CPU em [[selection-system]] / [[edit-system]]):

| Stream | Lido como | Significado |
|---|---|---|
| `selectionMask` (R8) | `sp_selected()` | 1 = selecionado |
| `editQuat` (RGBA32F) | rotação commitada (x,y,z,w) |
| `editTS` (RGBA32F) | xyz = translação, w = escala |
| `editColor` (RGBA8) | cor absoluta + a = flag de override |
| `splatLabel` (R8) | rótulo por-splat |

`splat.uv` é o endereço de textura do splat atual (fornecido pela engine).

---

## Uniforms (vindos de `setParameter`)

| Uniform | Origem | Papel |
|---|---|---|
| `uHasActiveOp` | [[edit-system]] | há operação ativa em preview? |
| `uActiveQuat`, `uActiveTS`, `uActivePivot`, `uActiveColor` | [[edit-system]] | preview da op |
| `uSelHighlightColor`, `uSelHighlightStrength` | [[selection-system]] | realce |
| `uLabelColoring`, `uLabelBlend`, `uLabelMax`, `uLabelSatBandSize`, `uLabelColorMapMode`, `uLabelColorScheme` | [[selection-system]] | visualizador de labels |

---

## Funções auxiliares de quaternion (linhas 40–46)

```glsl
vec3 sp_rotq(vec4 q, vec3 v)  // rotaciona v pelo quaternion q
vec4 sp_qmul(vec4 a, vec4 b)  // multiplica quaternions (composição de rotações)
float sp_selected()           // lê selectionMask no uv do splat
```
Essas mesmas fórmulas são **replicadas na CPU** em [[edit-system]] e [[ply-exporter]]
para manter coerência GPU↔CPU. A derivação (`sp_rotq` = expansão de `q·v·q⁻¹`;
`sp_qmul` = produto de Hamilton, não comutativo) está em [[concepts]] §8.

## Paletas Paul Tol (linhas 48–89)
`brightColor`, `vibrantColor`, `mutedColor`, `sunsetColor` retornam cores de
paletas qualitativas indexadas por label; `highContrastColor` escolhe a paleta por
`uLabelColorScheme` (0=bright, 1=vibrant, 2=muted, 3=sunset). Mapeamento de
índice→esquema feito em [[selection-system]] (`applyLabelViewerParameters`).

---

## As três funções obrigatórias

### `modifySplatCenter(inout vec3 center)` (linhas 91–99)
```glsl
vec3 c = ts.xyz + ts.w * sp_rotq(q, center);                 // 1) edição commitada
if (uHasActiveOp > 0.5 && sp_selected() > 0.5) {             // 2) preview da op ativa
    c = uActivePivot + uActiveTS.w * sp_rotq(uActiveQuat, c - uActivePivot) + uActiveTS.xyz;
}
center = c;
```
1. Aplica a **transformação de similaridade commitada** (`editTS` + `editQuat`) ao
   centro base que a GPU fornece.
2. Se o splat está selecionado **e** há op ativa, aplica também o **preview** da
   operação em torno do pivô `uActivePivot`.

Essa é exatamente a matemática `editado = t + s·rot(q, base)` documentada em
[[edit-system]] e replicada em [[ply-exporter]].

### `modifySplatRotationScale(...)` (linhas 101–110)
Compõe a rotação commitada (`sp_qmul(q, rotation)`) e a escala (`scale * ts.w`); se
selecionado + op ativa, compõe também o preview (`uActiveQuat`, `uActiveTS.w`).

### `modifySplatColor(inout vec4 color)` (linhas 112–146)
Ordem de aplicação (cada etapa pode sobrescrever a anterior):
1. **override commitado**: se `editColor.a > 0.5`, `color.rgb = editColor.rgb`.
2. **preview de cor**: se selecionado e `uActiveColor.a > 0.5`, usa `uActiveColor`.
3. **label viewer** (se `uLabelColoring`): converte o rótulo em cor (HSV quando
   `uLabelColorMapMode <= 0.5`, ou paleta Paul Tol caso contrário) e mistura por
   `uLabelBlend`. A banda de saturação (`band`/`sat`) alterna a saturação a cada
   `uLabelSatBandSize` rótulos para distinguir vizinhos.
4. **realce da seleção** (por último, para ler claramente): mistura para
   `uSelHighlightColor` por `uSelHighlightStrength`.

---

## GLSL vs WGSL (linhas 148–282)

O bloco `wgsl` é uma tradução 1:1 do `glsl`. Diferenças mecânicas:
- `texelFetch(tex, uv, 0)` → `textureLoad(tex, uv, 0)`.
- `inout T` → `ptr<function, T>` (e desreferência `*center`).
- uniforms acessados via `uniform.<nome>`.
- paletas usam `if` em cadeia em vez de array literal indexado.

A variante usada depende do `deviceType` ([[config]]): GLSL no WebGL2, WGSL no WebGPU.

## Atualizações (sessão atual)

`modifySplatColor` ganhou, **no topo**, um teste do stream `hidden` (R8): se `> 0.5`,
faz `color.a = 0` e retorna cedo — usado por [[retexture]] (via `hideSelected` de
[[selection-system]]) para ocultar a região substituída pela retextura. O stream `hidden`
é criado em todas as entidades selecionáveis (default 0).
