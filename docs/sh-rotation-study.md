# Estudo — Rotação de Spherical Harmonics para export de PLY com SH

> Documento de estudo (pré-implementação) para a feature "exportar `.ply` com SH
> de ordem superior". Decisão de produto já tomada: em export `whole` com bandas
> heterogêneas, **padroniza-se pela banda máxima** (assets sem SH recebem zeros).
> O objetivo deste documento é eliminar o risco da parte difícil — a **rotação
> dos coeficientes SH** — antes de escrever o exportador.

## 0. Por que SH precisa girar (recapitulação do problema)

O exportador (`src/export/ply-exporter.mjs`) "assa" a transformação de mundo +
edições na geometria: a saída está em **world space**. A engine, porém, avalia
SH **no frame local do asset** — ela inverte a model matrix e leva a direção de
visão para o espaço do modelo (`scene/gsplat/gsplat-resolve-sh.js:263–264`), em
vez de girar os coeficientes. Os coeficientes `f_rest_*` armazenados vivem,
portanto, no frame do asset.

Como o PLY exportado vira um "modelo" novo cujo frame é world space, um viewer
qualquer avaliará os SH com direções de visão **em world space**. Para que a cor
view-dependent continue casando com a geometria rotacionada, os coeficientes
precisam ser reexpressos no frame de saída.

Formalmente, queremos `D(R)` (operador linear sobre o vetor de coeficientes) tal
que, para toda direção `d`:

```
evalSH(D(R)·sh, d) = evalSH(sh, R⁻¹·d)
```

onde, **por-splat**, `R = qEdit ⊗ qEntity` (a mesma rotação à esquerda já
aplicada a `qBase` em `ply-exporter.mjs:120`; `qEntity` da entidade, `qEdit` do
mirror de edições). DC (banda 0) é invariante a `R`; bandas 1–3 **não**.

> Sanidade: as entidades têm rotação real (ex.: `biker1` em Euler `[180,-90,0]`,
> `main.mjs:106`). Logo a rotação é necessária **mesmo sem nenhuma edição**.

## 1. A base SH exata da engine

Fonte: `scene/shader-lib/glsl/chunks/gsplat/vert/gsplatEvalSH.js`. É a base real
do 3DGS da INRIA (`graphdeco-inria/.../sh_utils.py`). Coeficientes por canal:
banda 1 → 3, banda 2 → +5, banda 3 → +7 (total 3/8/15). Layout no PLY é
**canal-major**: `f_rest_0..14` = R, `15..29` = G, `30..44` = B (confirmado no
iterador `sh[j*15+k] → f_rest_{j*15+k}`).

Constantes: `SH_C1 = 0.4886025119029199 = √(3/4π)`, e os `SH_C2_*`, `SH_C3_*` da
tabela INRIA. Banda 1, explicitamente:

```
result_band1 = SH_C1 * (-sh[0]·y + sh[1]·z - sh[2]·x)
```

### 1.1 Mapa para a base canônica (o artefato mais propenso a erro)

A rotação real-SH "de livro" (Ivanic–Ruedenberg) opera na base canônica
ordenada `m = -l..+l`. É preciso uma matriz de mudança de base `Sₗ` (diagonal de
±1, possivelmente com permutação de índice) entre a ordenação/sinais da engine e
a canônica, **derivada por banda** comparando os polinômios de `evalSH` com as
SH reais canônicas. Banda 1, derivada:

```
Y_{1,-1} = √(3/4π)·y ,  Y_{1,0} = √(3/4π)·z ,  Y_{1,1} = √(3/4π)·x
⇒ result_band1 = -sh[0]·Y_{1,-1} + sh[1]·Y_{1,0} - sh[2]·Y_{1,1}
⇒ coef canônicos:  c_{1,-1} = -sh[0],  c_{1,0} = +sh[1],  c_{1,1} = -sh[2]
⇒ S₁ = diag(-1, +1, -1)   (índice já alinhado a m = -1,0,+1)
```

`S₂` e `S₃` devem ser derivados do mesmo modo (provavelmente diagonais ±1, mas
**isso precisa ser verificado**, não assumido). Esse passo é a principal fonte
de bugs silenciosos de convenção.

## 2. Dois métodos de rotação (e qual usar)

### Método A — Projeção numérica usando o `evalSH` da própria engine  ⭐ recomendado

Ideia: construir `D(R)` **diretamente na base da engine**, sem nunca derivar
`Sₗ`. Tudo o que precisamos é portar `evalSH` para JS (cópia 1:1 do chunk GLSL).

`D(R)` é linear em `sh`. A coluna `k` de `D` é o vetor de coeficientes que
representa a função `f_k(d) = evalSH(eₖ, R⁻¹·d)`. Recuperamos por mínimos
quadrados sobre um conjunto de direções de amostra `d_s` (M ≫ K, ex.: M=64–128
direções de um *spherical t-design* ou aleatórias normalizadas):

```
A[s][i]      = evalSH(e_i, d_s)            (M×K)  — base avaliada nas amostras
A_rot[s][k]  = evalSH(e_k, R⁻¹·d_s)        (M×K)  — base avaliada nas direções giradas
D(R) = A⁺ · A_rot                          (K×K)  — A⁺ = pseudo-inversa de A
```

`A` (e `A⁺`) é **constante por banda** → calcula-se uma vez. Por `R` único, é um
produto `K×K`. Vantagens decisivas para este código:
- usa **exatamente** a base da engine ⇒ imune a erro de convenção/sinal/ordem;
- o teste golden (§3) passa por construção (ainda assim, testar);
- trivial de implementar (sem recorrência de Wigner).

Operar por banda separadamente (D₁ 3×3, D₂ 5×5, D₃ 7×7) mantém os blocos pequenos
e bem-condicionados. Aplicar o mesmo `D` aos 3 canais (R,G,B).

### Método B — Analítico, Ivanic–Ruedenberg (referência / otimização futura)

Recorrência clássica que monta `Mˡ` a partir de `M¹` (= rotação 3×3 reordenada
para a base `(y,z,x)`) e `Mˡ⁻¹`, via coeficientes `u,v,w` e funções `U,V,W`
(J. Phys. Chem. 1996, 100, 6342; errata 1998, 102, 9099). É mais rápido, mas
exige acertar `Sₗ` e os sinais — **só vale a pena se a Fase de perf exigir**.
Implementações de referência conhecidas-corretas para conferência cruzada:
Google `spherical-harmonics` (`sh.cc`, `RotateSphericalHarmonics`), `e3nn`,
`DirectXMath XMSHRotate`.

> Recomendação do estudo: **implementar A primeiro** (correção), guardar B como
> otimização só se o perfil de performance pedir.

## 3. Metodologia de validação (teste golden — pré-requisito de qualquer merge)

Independente do método, validar contra a definição:

```
para N rotações R aleatórias e P direções d aleatórias:
    assert  evalSH(D(R)·sh, d) ≈ evalSH(sh, R⁻¹·d)   (sh aleatório)
    critério: max |erro| < 1e-5   (usar o evalSH portado da engine como verdade)
```

Casos-âncora adicionais:
- `R = I` ⇒ `D = I` (até tolerância);
- banda 1 com `S₁ = diag(-1,+1,-1)` deve coincidir com a permutação `(y,z,x)` da
  rotação 3×3 — checagem cruzada barata entre A e B;
- composição: `D(R₂)·D(R₁) ≈ D(R₂R₁)`;
- ortogonalidade aproximada: `Dˡ` quase ortogonal (rotação preserva norma SH).

Validação visual final (ponta-a-ponta): exportar `sample_label_only_compact.ply`
(o único asset do bundle com SH — bandas 3) sob a rotação real da entidade,
recarregar o PLF exportado e comparar o render com a cena original na **mesma
câmera**.

## 4. Desempenho e caching

- Splats não-editados de um selectable compartilham `R = qEntity` ⇒ **um** `D` por
  selectable. Só splats com `qEdit ≠ I` precisam de `D` próprio.
- Cachear `Map<quatKey, {D1,D2,D3}>` (quatKey = quaternizado/arredondado).
- Custo de aplicar: por splat e por canal, 3×3+5×5+7×7 = 83 mults ⇒ ~150k splats
  × 3 canais ≈ 38M mults. Aceitável para uma ação de export; o caching de `D`
  domina o ganho.

## 5. Caminho dos dados (já confirmado, para referência da implementação)

- `resolveSplatData()` já devolve `GSplatData` decodificado para os 3 formatos.
- SH disponíveis via `data.getProp('f_rest_k')`; nº de bandas via `data.shBands`
  (0–3). Compressed/SOG reconstroem `f_rest_*` no `decompress()`.
- **Disponibilidade por-asset no bundle:** `sample_label_only_compact.ply` →
  bandas 3; `biker.compressed.ply` → 0 (sem elemento SH); `apartment.sog` → 0
  (sem `shN`). ⇒ Merge "banda máxima + zeros" é necessário na prática.

## 6. Questões em aberto a resolver durante o estudo

1. Derivar e verificar `S₂`, `S₃` (se formos pelo Método B). Pelo Método A,
   dispensável.
2. Confirmar a convenção de `R`: usar `R = qEdit ⊗ qEntity` e `R⁻¹` no lado
   direito; validar pelo teste golden com um asset de rotação conhecida.
3. Escala não-uniforme: continua **fora de escopo** (não comuta com forma do
   gaussiano nem com SH). Detectar e avisar/abortar.
4. Quaternização do cache: tolerância de arredondamento vs. número de chaves.
5. Estabilidade numérica de `A⁺` (escolha de M e do conjunto de direções).

## 7. Plano de estudo (marcos)

- **M1 — Port + verificação de `evalSH`.** Portar `gsplatEvalSH` para JS;
  conferir valores contra o GLSL em direções fixas. (Saída: `sh-eval.mjs` + teste.)
- **M2 — `D(R)` pelo Método A.** Implementar `A`, `A⁺`, `D = A⁺·A_rot` por banda.
  (Saída: `sh-rotate.mjs`.)
- **M3 — Teste golden** (§3) verde a < 1e-5, incluindo composição e `R=I`.
- **M4 — Âncora banda-1** cruzando A com a permutação `(y,z,x)` da rotação 3×3.
- **M5 — Decisão A-vs-B**: medir custo; só investir em B (Ivanic) se necessário.
- **M6 — Spec de integração**: como o exportador lê `shBands`, monta os 3 canais,
  aplica `D(R)`, aplica a política "banda máxima + zeros" e escreve `f_rest_*`.

Concluídos M1–M4, a feature deixa de ter risco matemático e a implementação do
exportador (estender `PROPS`/header + loop de escrita) é mecânica.

## 8. Referências

- Inria 3DGS, `utils/sh_utils.py` (base real usada pela engine).
- Ivanic & Ruedenberg, *Rotation Matrices for Real Spherical Harmonics*,
  J. Phys. Chem. 100 (1996) 6342; errata 102 (1998) 9099.
- Green, *Spherical Harmonic Lighting: The Gritty Details* (2003).
- Sloan, *Stupid SH Tricks* (2008) — rotação e pitfalls de convenção.
- Google `spherical-harmonics` (`sh.cc`) e `e3nn` — implementações de referência.
