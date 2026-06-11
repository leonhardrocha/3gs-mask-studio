# `export/ply-exporter.mjs` — serializa PLY (mundo + edições)

**Arquivo:** `src/export/ply-exporter.mjs`
**Papel:** exporta os splats para um **PLY binário little-endian**, aplicando na CPU
a **mesma matemática** do [[workbuffer-modifier]] sobre os dados originais
(decomprimidos sob demanda). Saída em **espaço-mundo**.

Voltar ao índice: [[README]] · Chamado por: [[main]] (evento `exportPly`) ·
Seleção: [[selection-system]] · Edições: [[edit-system]]
Pré-requisitos de baixo nível: [[concepts]] §5 (SH/DC e `SH_C0`), §6 (escala-log),
§8 (quaternions), §4 (readback da máscara)

---

## O que ele produz

Para cada splat exportado, replica na CPU:
```
posOut   = t + s · rot(q, M · posLocal)          (M = matriz de mundo da entidade)
rotOut   = qEdit ⊗ (qEntity ⊗ qLocal)
scaleOut = log( entityScale · exp(scaleLocalLog) · sEdit )   (por eixo)
colorOut = override ? (rgb − 0.5) / SH_C0 : f_dc_local
```
- **Espaço-mundo**: o placement da entidade é embutido, então vários selectables se
  fundem num frame de coordenadas consistente.
- **Escopo** `subset` mantém só `selectionMask > 0`; `whole` mantém todos.

> **Limitações documentadas**: só **cor DC** (SH de ordem alta é descartado — ver
> `ARCHITECTURE.md` §10) e assume escala de entidade/edição **uniforme**.

`SH_C0 = 0.28209479177387814` (linha 20) é o coeficiente DC dos harmônicos esféricos
(banda 0 = `0.5·sqrt(1/π)`), usado para converter RGB ↔ `f_dc`: `cor = 0.5 + SH_C0·f_dc`.
Detalhes em [[concepts]] §5.

---

## Passo a passo

### 1. Propriedades do PLY (linhas 22–24)
```js
const PROPS = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
const STRIDE = PROPS.length;   // 14 floats por vértice
```
A **ordem** aqui deve casar com a ordem de escrita no corpo (passo 5).

### 2. `resolveSplatData(selectable)` (linhas 27–38)
Obtém um `GSplatData` da CPU com `getProp`, descomprimindo se necessário:
```js
if (gd.getProp && gd.getProp('x'))        data = gd;                 // PLY não comprimido
else if (gd.decompress)                   data = await gd.decompress(); // comprimido / SOG
selectable._cpuData = data;   // cache
```
Faz cache em `_cpuData` para não descomprimir duas vezes.

### 3. Coleta de partes + contagem (linhas 47–82)
Para cada selectable habilitado:
- resolve os dados CPU (pula com warning se não houver);
- se `scope === 'subset'`, faz **readback** da `selectionMask` e monta a lista de
  `indices` com `mask[i] > 127`; senão `indices = null` (todos);
- acumula `total` e guarda `{ s, data, indices, count }`.

Se `total === 0`, aborta com warning.

### 4. Buffer de saída (linha 85)
```js
const out = new Float32Array(total * STRIDE);
```

### 5. Laço por splat (linhas 88–147)
Lê os arrays de propriedades (`x/y/z`, `rot_0..3`, `scale_0..2`, `f_dc_0..2`,
`opacity`) e os parâmetros de mundo da entidade (`getWorldTransform`,
`getRotation`, `getScale`) e o **mirror** de [[edit-system]] (`getEditedMirror`).

Para cada splat (índice `i`, `k = i*4` no mirror):

**Posição** (linhas 109–115):
```js
p.set(x[i], y[i], z[i]);  wm.transformPoint(p, p);   // M · posLocal
qEdit.set(m.quat[k..]);   qEdit.transformVector(p, p); // rot(qEdit, ·)
ox = m.ts[k]   + sEdit * p.x;   // t + s·rot(q, M·pos)
oy = m.ts[k+1] + sEdit * p.y;
oz = m.ts[k+2] + sEdit * p.z;
```
Mesma fórmula `t + s·rot(q, base)` do [[workbuffer-modifier]] `modifySplatCenter`.

**Rotação** (linhas 117–120):
```js
qBase.set(r1[i], r2[i], r3[i], r0[i]);   // (x,y,z,w) — no PLY rot_0 é o w
qWorld.mul2(qEntity, qBase);             // qEntity ⊗ qLocal
qOut.mul2(qEdit, qWorld);                // qEdit ⊗ (qEntity ⊗ qLocal)
```

**Cor** (linhas 123–130): se `m.color[k+3] > 127` (override), converte o RGB do
mirror para `f_dc` via `(c/255 − 0.5)/SH_C0`; senão usa os `f_dc` originais.

**Escala** (linhas 139–141): soma em log:
`scale_n + log(entityScale_n) + log(sEdit)` = `log(entityScale · exp(scaleLog) · sEdit)`.
A escala dos splats é guardada em espaço **log**, então multiplicar escalas vira
**somar** — ver [[concepts]] §6.

> **Opacidade** (linha 138): é copiada **sem transformação** (`op[i]`). As edições do
> app não mexem em opacidade, então o valor bruto do asset (logit) passa direto. Os
> três `f_rest_*` (SH de ordem alta) **não** são gravados — só o DC.

**Escrita** (linhas 132–145): grava os 14 floats na ordem de `PROPS` (note `rot_0 =
qOut.w`, depois x,y,z).

### 6. Header + download (linhas 150–170)
Monta o header de texto:
```
ply
format binary_little_endian 1.0
comment exported by splatting-paint (world space, DC color only)
element vertex <total>
property float x ... property float rot_3
end_header
```
Concatena `header` (bytes) + `out.buffer` num `Blob`, cria um `<a download>` e
dispara o clique para baixar `selection-<scope>.ply`. Revoga a URL depois de 1s.

---

## Coerência GPU ↔ CPU
Este exportador é o "espelho na CPU" do [[workbuffer-modifier]]: as mesmas fórmulas
de centro/rotação/escala/cor são reaplicadas aqui sobre os dados originais, usando o
mirror commitado de [[edit-system]]. Por isso o `.ply` reflete o que se vê na tela.

## Atualizações (sessão atual)

- **`buildPlyBlob`** (extraído de `exportPly`; retorna `{ blob, count }`) agora **inclui os
  SH** (`f_rest_*`) por **pass-through** quando a origem os tem — colunas uniformes pelo máximo
  entre objetos, na posição padrão (entre `f_dc` e `opacity`). *Limitação:* os SH **não** são
  rotacionados (Wigner-D) → sob rotação de entidade/edição a cor view-dependent fica inexata
  (warning logado). Ver `../../sh-rotation-study.md`.
- **`buildRawSelectionPly({ system })`** (para [[retexture]]): exporta a seleção em **coords
  originais/locais** (sem placement, sem edição, sem override; com SH), de **um** objeto
  (`multi:true` se cruzar objetos). Retorna `src` + `indices` para a reaplicação da transformação.
- `getProp('f_rest_N')` vem da `decompress()` da engine (reconstrói os SH quando `shBands > 0`).
