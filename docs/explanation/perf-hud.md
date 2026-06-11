# `src/perf-hud.mjs` — HUD de baseline de performance

Overlay DOM leve que lê `app.stats.frame` e mostra as métricas que importam para o
trabalho de otimização. Serve como régua "antes/depois".

> Wiring em [[main]]; métrica-chave relacionada ao [[workbuffer-modifier]] e ao custo de re-render.

## O que mostra

- **FPS / ms** (min/avg/max) — suavidade (proxy de desktop).
- **splats / draws** — volume desenhado no frame.
- **copy%** (`gsplatBufferCopy`) — **% de blocos do work buffer recopiados no frame**.
  É o sinal-chave: é proporcional ao trabalho de GPU e independente de plataforma, então
  vale mesmo medindo no desktop. Acompanha `avg` e **PEAK** (o número a vencer).
- **sort** (`gsplatSort`) — sort global dos splats (roda todo frame em VR, pois a câmera se move).
- **snap** — quando o snap em XR está ativo: `depth / jitter / dropout` (vindo de
  `data.snapStats`, escrito por [[xr-session]]).

## Como funciona

- Atualiza no evento **`frameend`** do app (após o `render` preencher os stats, antes do
  `frameEnd()` que reseta `gsplatSort`).
- Acumula min/avg/max e o **PEAK** de `copy%` a cada frame; repinta o DOM a ~6 Hz.
- Teclas: **`** (crase) liga/desliga · **~** zera os acumuladores (use antes de uma ação medida).

## Medindo

Zere com `~`, faça uma ação (pincelar / arrastar uma edição num objeto grande) e leia o
**PEAK de copy%**. Para FPS real **no headset**, use o OVR Metrics Tool (o HUD em DOM não
aparece dentro do VR); o `copy%` continua sendo a métrica acionável de engine.
