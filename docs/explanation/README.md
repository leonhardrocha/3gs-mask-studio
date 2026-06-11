# Explicação do código — `src/`

Este diretório contém um arquivo `.md` para **cada arquivo de `src/`**, explicando
o código passo a passo. A estrutura de pastas espelha a de `src/`.

Os links abaixo usam a sintaxe `[[wikilink]]` do **Obsidian** — abra esta pasta como
um *vault* (ou abra o vault na raiz do projeto) e navegue clicando nos nós.

> Para a visão arquitetural de alto nível, veja [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).
> Para os conceitos de baixo nível compartilhados (pipeline GSplat, streams,
> quaternions, SH/DC, escala-log, blend), veja **[[concepts]]**.

---

## Mapa de navegação


[[main]]  ← orquestrador / ponto de entrada
  │
  ├── [[concepts]]            conceitos de baixo nível (referência transversal)
  ├── [[config]]              deviceType + rootPath
  ├── [[observer]]            store observável (estado global)
  ├── [[controls]]            painel HTML (two-way binding)
  ├── [[style]]               CSS do painel
  ├── [[history]]             pilha undo/redo (comandos)
  ├── [[perf-hud]]            HUD de baseline (fps/ms/copy%/snap)
  ├── [[retexture]]           ferramenta de retextura (serviço externo)
  ├── [[workbuffer-modifier]] shader central (realce + edições + labels + hidden)
  │
  ├── selection/
  │     ├── [[selection-system]]  máscara por-splat + brush + escopo + hidden + undo
  │     ├── [[brush-input]]       input desktop (mouse + Picker)
  │     └── [[splat-index]]       índice espacial CPU p/ snap em XR
  │
  ├── edit/
  │     └── [[edit-system]]       preview + commit + undo + reapply
  │
  ├── export/
  │     └── [[ply-exporter]]      serializa PLY (mundo+SH; ou cru p/ retextura)
  │
  └── xr/
        ├── [[xr-session]]        sessão VR + raio + snap + remap de input
        ├── [[controllers]]       proxy de controle + raio (+ box fallback)
        ├── [[controller-models]] modelos glTF (Input Profiles) + ícones
        ├── [[mode-panel]]        painel de modos world-space (lazy-follow)
        └── [[locomotion]]        navegação pelo mundo (rig)


## Fluxo de dados (resumo)

1. **[[observer]]** guarda o estado; **[[controls]]** lê/escreve nele (UI).
2. **[[main]]** instancia os sistemas e conecta eventos do observer aos sistemas.
3. **[[brush-input]]** / **[[xr-session]]** convertem input em chamadas
   `system.queueSelect(...)` de **[[selection-system]]**.
4. **[[selection-system]]** grava a máscara na GPU; **[[edit-system]]** aplica
   transformações; ambos dependem do **[[workbuffer-modifier]]** para o efeito visual.
5. **[[ply-exporter]]** replica a matemática do shader na CPU para gerar o `.ply`.

## Nota sobre a engine

Este projeto **não** usa o pacote npm `playcanvas`: ele aliasa `import 'playcanvas'`
para um *checkout* local beta da engine (ver [[config]] e `vite.config.mjs`). Por
isso vários documentos trazem **trechos do código-fonte da engine** para esclarecer
o comportamento esperado de APIs como `GSplatProcessor`, `setWorkBufferModifier`,
`getInstanceTexture` e `Picker.getWorldPointAsync`.
