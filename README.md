# Splatting Select

Utilitário standalone para **selecionar, editar, retexturizar e exportar regiões
de Gaussian Splats**, baseado na engine PlayCanvas. Derivado do exemplo
`gaussian-splatting/paint`, porém **sem** o navegador de exemplos (sem
React/PCUI/Monaco) — apenas a cena, um painel de controles leve e a engine
consumida direto da source local.

O pincel não pinta: ele **marca uma máscara de seleção** por-splat (escopável por
objeto). A partir da seleção dá para **mover / rotacionar / escalar / recolorir**,
**desfazer/refazer**, **retexturizar** (via serviço externo) e **exportar** um novo
`.ply` (com SH). Funciona no **desktop** (mouse) e em **XR/VR** (raio do controle,
locomoção, modelos 3D dos controles e um **painel de modos** navegado por joystick).

## Pré-requisitos

- Node.js ≥ 18
- Um checkout local da engine PlayCanvas (consumida via *source-alias*, não via
  npm). O caminho é específico da sua máquina e é configurado por variável de
  ambiente — veja abaixo.
- (Opcional, p/ retextura) o serviço de retextura rodando em `http://localhost:5000`
  **na mesma máquina** do dev server.

## Configuração

A engine é apontada pela variável `ENGINE_PATH`. Copie o modelo e ajuste o
caminho para o `src/index.js` da sua engine local:

```bash
cp .env.example .env
# edite .env e defina ENGINE_PATH=/caminho/para/engine/src/index.js
```

O `.env` é ignorado pelo git. Alternativamente, passe a variável direto no
comando: `ENGINE_PATH=/caminho/para/engine/src/index.js npm run dev`.

O serviço de retextura é acessado via proxy do Vite (`/retex`), apontando por
padrão para `http://localhost:5000` (configurável por `RETEXTURE_SERVICE`).

## Rodando

```bash
npm install
npm run dev
```

Abra a URL exibida (por padrão http://localhost:5173). WebGPU (opcional):
`?device=webgpu` — note que o snap de superfície do desktop é WebGL-only.

> Mudanças no `vite.config.mjs` (ex.: proxy) exigem **reiniciar** o dev server.

## Controles — desktop

- **Botão direito** — seleciona (snap na superfície). **Shift** inverte o modo.
- **Botão esquerdo** — orbita · **roda** — zoom · **botão do meio** — pan
- **Ctrl+Z / Ctrl+Shift+Z** — desfazer / refazer · **Alt+L** — visualizador de labels
- **M** — abre o painel de modos (setas navegam, Enter confirma, Esc fecha)
- **`** (crase) — liga/desliga o HUD de performance · **~** — zera os acumuladores do HUD

Painel à direita: histórico (desfazer/refazer), seleção (objeto ativo,
aditivo/subtrativo, tamanho, limpar/inverter), realce, **transformar a seleção**
(mover/rotar/escala/cor + Aplicar), labels (paletas Paul Tol), visibilidade por
splat, **exportar** (`.ply` da seleção ou da nuvem inteira), **retexturizar**
(escolher objeto/textura + adicionar/aplicar), carregar `.ply`/`.sog` extra e o painel **XR**.

## Controles — XR (VR)

Entre por **XR → Entrar em VR** (clique dentro da página, para ter user-activation).
Testar no Quest exige **HTTPS** — exponha o dev server (`host: true` já está
configurado) e use um túnel HTTPS (ex.: ngrok) apontando para a porta 5173.

A maior parte da interface é o **painel de modos**, aberto pelo botão **A**.

| Controle | Painel fechado | Painel aberto |
|---|---|---|
| Botão **A** (direito) | abre o painel | fecha o painel |
| Gatilho direito | selecionar (modo Seleção) | confirmar item |
| Analógico esquerdo | mover no plano | navegar / ajustar |
| Analógico direito X / Y | giro suave / subir-descer | — (locomoção suspensa) |
| **B** (direito) | — | fecha o painel |
| **X / Y** (esquerdo) | diminui / aumenta o pincel | — |

Ícones sobre os botões indicam a ação: **grade** (menu/A), **ponto** (gatilho),
**−** (X), **+** (Y). Os modelos dos controles são os reais (WebXR Input Profiles).

## Painel de modos

- **Seleção** — modo (+/−), pincel, objeto ativo, limpar, inverter.
- **Edição** — preview, Op (mover/rotacionar/escalar), eixo, **Ajustar** (contínuo no
  stick → preview ao vivo), recolorir, Aplicar (commit), resetar.
- **Exportar** — `.ply` da seleção ou da nuvem inteira.
- **Retexturizar** — objeto do catálogo, **Adicionar objeto**, textura, **Aplicar
  retexturização**, status.
- **Globais** (em todo modo) — desfazer, refazer, labels.

## Retexturização

1. Crie a seleção (de **um** objeto).
2. No painel **Retexturizar**, escolha a textura e **Aplicar retexturização**.
3. A seleção é enviada ao serviço em **coords originais** (sem transformação); o ply
   retexturizado retorna e **substitui** a região, com as transformações reaplicadas.

**Adicionar objeto** baixa um ply pré-treinado do catálogo (ex.: `Fruits`, via
`/download_ply/{nome}`) e o adiciona à cena.

## Arquitetura

Veja [`ARCHITECTURE.md`](./ARCHITECTURE.md) para o desenho completo (máscara de
seleção, edição, undo, snap, controles 3D, painel de modos, retextura, export PLY,
integração com a engine e XR) e [`docs/explanation/`](./docs/explanation/) para a
explicação por-módulo.
