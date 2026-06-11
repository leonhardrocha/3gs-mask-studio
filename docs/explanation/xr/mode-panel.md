# `src/xr/mode-panel.mjs` — painel de modos world-space

Menu virtual que **lazy-follow** a cabeça e é dirigido pelo joystick. Substitui a
sobrecarga de botões por **modos** (Seleção / Edição / Exportar / Retexturizar);
"Visualização" (labels) e undo/redo são **itens globais** em todo modo.

> Wiring/input em [[xr-session]] e [[main]]; aciona eventos do [[observer]] (mesmos do [[controls]]).

## Renderização

Um **canvas 2D** é desenhado (cabeçalho do modo + linhas de opção + foco) e enviado a uma
**textura** mapeada num quad. O quad fica na layer **`UITop`** (`render.layers`), renderizada
após o World com depth limpo, para os splats **não o ocultarem**.

> Orientação: a engine não dá `flipY` em texturas de canvas, então o `redraw` **pré-rotaciona
> 180°** (`translate(W,H); scale(-1,-1)`) para o painel sair legível e não-espelhado no quad.

## Modelo de modos (declarativo)

`MODES` = lista de `{ id, name, items() }`. Cada item pode ter `activate()` (ação/toggle),
`adjust(dir)` (ciclo discreto) ou `cont(amount)` (ajuste contínuo numérico). O **cabeçalho**
(linha 0) troca de modo. Itens globais (undo/redo/labels) são anexados a todo modo.

- **Seleção:** modo (+/−), pincel (cont), objeto (ciclo), limpar, inverter.
- **Edição:** preview, Op (ciclo mover/rotacionar/escalar), Eixo (ciclo), **Ajustar** (cont →
  nudge em `editTx…`/`editScale`, preview ao vivo), recolorir, commit, reset.
- **Exportar:** seleção / tudo.
- **Retexturizar:** objeto (ciclo do catálogo), adicionar objeto, textura, aplicar, status.

## Navegação

- **vertical** → move o foco.
- **horizontal** → troca de modo (no cabeçalho), ajuste **contínuo** (`adjustContinuous`,
  proporcional ao stick) nas linhas numéricas, ou **passo** discreto nas de ciclo.
- **ativar** → executa a ação do item focado.

`updateFollow(dt)` posiciona o quad ~0.7 m à frente da câmera (lerp) e o orienta para ela.
Funciona no **desktop** (lazy-follow na câmera; teclas **M** abre, setas/Enter/Esc), o que
permite testar sem headset.
