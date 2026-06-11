# `src/history.mjs` — pilha de undo/redo

Histórico linear de **comandos**. Um comando é um triplo `{ label, undo(), redo() }`
que carrega o mínimo para se reverter (modelo *op-stack*), então a memória é
proporcional ao que mudou, não à cena.

> Conceitos: [[concepts]] · usado por [[edit-system]] e [[selection-system]] · wiring em [[main]].

## API

`createHistory({ data, max = 50 })` → `{ push, undo, redo, clear, canUndo, canRedo }`.

- **`push(command)`** — empilha em `undoStack`, **limpa o `redoStack`** (histórico
  linear), respeita a profundidade `max` (descarta o mais antigo).
- **`undo()` / `redo()`** — tira do topo de uma pilha, executa o lado correspondente
  (em `try/catch`) e move para a outra pilha.
- Espelha **`canUndo` / `canRedo`** no [[observer]] (para a UI habilitar/desabilitar).
- Escuta os eventos `undo` / `redo`.

## Quem empilha comandos

- **[[edit-system]] `commit`** — guarda `prev`/`next` do mirror **só dos splats afetados**
  (memória ∝ seleção). `undo` escreve os valores antigos; `redo`, os novos.
- **[[selection-system]]** — `clear`, `invert` e cada **pincelada** (`beginStroke` →
  `endStroke`) guardam *snapshots* da máscara (antes/depois) e empilham um comando que
  faz upload do estado correspondente.

## Observações

- **Undo não custa renderização** — é estado em CPU; o modifier lê os streams todo frame
  independentemente do histórico.
- A retextura **não** é undoable nesta versão (operação de rede + novo objeto).
- Atalhos: Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo); botões no [[controls]].
