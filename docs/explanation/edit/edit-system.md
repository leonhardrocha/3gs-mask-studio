# `edit/edit-system.mjs` — preview + commit das edições

**Arquivo:** `src/edit/edit-system.mjs`
**Papel:** aplica **mover / rotacionar / escalar (uniforme) / recolorir** à seleção
atual, com **preview ao vivo na GPU** e um resultado **commitado e empilhável**.

Voltar ao índice: [[README]] · Criado por: [[main]] ·
Preview no shader: [[workbuffer-modifier]] · Lê seleção de: [[selection-system]] ·
Fonte de verdade do export: [[ply-exporter]]
Pré-requisitos de baixo nível: [[concepts]] §8 (quaternions/similaridade),
§4 (readback `read` vs `lock`), §3 (índice `k = i*4`)

---

## Modelo (edit-list híbrida)

- A operação **ativa** é mostrada via **uniforms** (`uActive*`) no
  [[workbuffer-modifier]] — preview sem custo de CPU.
- No **commit**, a operação é "dobrada" numa **transformação de similaridade
  por-splat** armazenada num **mirror na CPU** e enviada às streams `editQuat` /
  `editTS` / `editColor`. O mirror é a **edit-list acumulada** e a fonte de verdade
  do export.

Transformação armazenada por-splat (mapeia o centro base → mundo editado):
```
editadoCentro = t + s · rot(q, baseCentro)
```
Composição de uma nova op (rotação `Ra`, escala uniforme `sa`, translação `ta` em
torno do pivô `P`) sobre `{q, t, s}` existente:
```
q' = Ra ⊗ q
s' = sa · s
t' = P + sa · Ra·(t − P) + ta
```
> Não é preciso ter os dados base do splat na CPU (a GPU os fornece), então funciona
> também para fontes comprimidas e SOG.

---

## Passo a passo

### 1. Temporários reutilizáveis (linhas 24–36)
Quaternions/vetores (`Ra`, `qi`, `qn`, `ti`, `ta`, `tmpV`, `tmpC`, `mq`) alocados
uma vez para evitar *garbage* por frame. `activeQuat()` monta o quaternion da
rotação ativa a partir de `editRx/Ry/Rz` (Euler).

### 2. `getMirror(s)` (linhas 38–51)
Cria sob demanda o mirror CPU de um selectable:
```js
const quat  = new Float32Array(n * 4);  // identidade (0,0,0,1)
const ts    = new Float32Array(n * 4);  // (0,0,0,1) → translação 0, escala 1
const color = new Uint8Array(n * 4);    // 0 → sem override
```
Inicializa `w = 1` em `quat` e `ts` (identidade). Guardado em `s._mirror`.

### 3. `pushPreview()` (linhas 53–68) — preview ao vivo
Lê a op atual do [[observer]] e seta os uniforms `uActive*` em **todos** os
selectables:
```js
c.setParameter('uHasActiveOp', editing ? 1 : 0);
c.setParameter('uActiveQuat',  [q.x, q.y, q.z, q.w]);
c.setParameter('uActiveTS',    [Tx, Ty, Tz, Scale]);
c.setParameter('uActivePivot', [pivot...]);
c.setParameter('uActiveColor', editColorEnabled ? [r,g,b,1] : [0,0,0,0]);
s.entity.gsplat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ONCE;   // re-renderiza
```
O shader ([[workbuffer-modifier]] `modifySplatCenter`) aplica esses uniforms só aos
splats com `selectionMask > 0`.

### 4. `recomputePivot()` (linhas 71–108) — centróide da seleção
Pivô = **centróide em espaço-mundo** da seleção atual:
1. Para cada selectable habilitado, faz **readback** da `selectionMask`
   (`tex.read(...)`).
2. Pega os centros base via `resource.gsplatData.getCenters()`.
3. Para cada splat selecionado (`mask[i] > 127`), transforma o centro pela matriz de
   mundo da entidade e **aplica o mirror** (`t + s·rot(q, base)`) para usar a posição
   **editada**, acumulando em `sum`.
4. `pivot = sum / count`.

Fallback (linhas 99–104): formatos sem centros na CPU usam a origem da entidade.
É `async` (readback de GPU). Ao final chama `pushPreview()` (o preview gira em torno
do novo pivô).

### 5. `uploadMirror(s, includeColor)` (linhas 110–120)
Envia os arrays do mirror para as texturas de instância via `lock()`/`set()`/`unlock()`
(`editQuat`, `editTS`, e `editColor` se houve recolor).

### 6. `commit()` (linhas 123–167) — dobra a op no mirror
Para cada selectable, faz readback da máscara e, para cada splat selecionado, compõe
a op no mirror exatamente como nas fórmulas acima:
```js
qn.mul2(ra, qi);                       // q' = Ra ⊗ q
tmpV.sub2(ti, P); ra.transformVector(tmpV, tmpV); tmpV.mulScalar(sa); // sa·Ra·(t−P)
m.ts[k]   = P.x + tmpV.x + ta.x;       // t' = P + sa·Ra·(t−P) + ta
m.ts[k+3] = sa * si;                   // s' = sa · s
if (colEnabled) m.color[k..] = (cr, cg, cb, 255);   // override de cor
```
Se algum splat foi tocado, faz `uploadMirror` e dispara `WORKBUFFER_UPDATE_ONCE`.
Ao final, `reset()`. É **empilhável**: chamar commit de novo compõe sobre o anterior.

### 7. `reset()` (linhas 170–176)
Zera a op ativa no [[observer]] (`editTx..`, `editRx..`, `editScale=1`,
`editColorEnabled=false`) — mantém `editing` ligado — e refaz o preview. Como os
sliders de [[controls]] usam `boundSlider` (two-way), eles voltam visualmente a zero.

### 8. `getEditedMirror(s)` (linha 179)
Expõe o mirror para o [[ply-exporter]] (mesma estrutura usada no commit).

### 9. Wiring (linhas 182–192)
- Cada campo de preview (`editTx..editColorEnabled`) → `pushPreview` ao mudar.
- `editing:set` → se ligou, `recomputePivot()`; se desligou, `pushPreview()`.
- `commitEdit` → `commit()`; `resetEdit` → `reset()`; `recomputePivot` → recalcula.

---

## API retornada (linha 194)
`{ pushPreview, recomputePivot, commit, reset, getEditedMirror, getPivot }`.

## Por que escala só uniforme?
Restringir a similaridade (rotação + escala **uniforme** + translação) mantém a
composição limpa (`q'`, `s'`, `t'` fecham em si) e o armazenamento compacto. Escala
não-uniforme quebraria a composição de quaternion. Ver `ARCHITECTURE.md` §6 e a
prova de fechamento em [[concepts]] §8.

## Por que um mirror na CPU?
A GPU já tem os centros base, mas **compor** uma nova operação sobre a anterior exige
conhecer `{q, t, s}` acumulados de cada splat — e o shader não pode ler+escrever a
mesma stream no mesmo passe ([[concepts]] §7). O mirror (`Float32Array`/`Uint8Array`)
é essa memória acumulada na CPU: o commit lê o estado anterior do mirror, compõe a
op e faz `uploadMirror` (um `lock`/`set`/`unlock`, GPU-bound barato — [[concepts]] §4).
Como o mirror nunca precisa dos dados-base do splat, funciona igual para PLY
comprimido e SOG. É também a **fonte de verdade do export** ([[ply-exporter]]).

## Atualizações (sessão atual)

- **Undo de edição** ([[history]]): no `commit`, captura `prev`/`next` do mirror **só dos
  splats afetados** (memória ∝ seleção) e empilha um comando `{undo, redo}`.
- **`reapplyEdits(target, src, srcIndices)`**: copia o mirror por-splat de um objeto para
  outro (1:1 por índice), sem o override de cor — usado por [[retexture]] para reaplicar as
  edições ao ply retornado pelo serviço.
