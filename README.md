# Splatting Select

Utilitário standalone para **selecionar, editar e exportar regiões de Gaussian
Splats**, baseado na engine PlayCanvas. Derivado do exemplo
`gaussian-splatting/paint`, porém **sem** o navegador de exemplos (sem
React/PCUI/Monaco) — apenas a cena, um painel de controles leve e a engine
consumida direto da source local.

O pincel não pinta: ele **marca uma máscara de seleção** por-splat. A partir da
seleção dá para **mover / rotacionar / escalar / recolorir** e **exportar** um
novo `.ply`. Funciona no **desktop** (mouse) e em **XR/VR** (raio do controle +
locomoção pelo mundo).

## Pré-requisitos

- Node.js ≥ 18
- O repositório da engine em
  `/home/douglas/Documentos/Atlantico/supersplat/3gs-mask-studio`
  (a engine é consumida via *source-alias*, não via npm).
  Caminho diferente? Use `ENGINE_PATH`:
  ```bash
  ENGINE_PATH=/caminho/para/3gs-mask-studio/src/index.js npm run dev
  ```

## Rodando

```bash
npm install
npm run dev
```

Abra a URL exibida (por padrão http://localhost:5173). WebGPU (opcional):
`?device=webgpu` — note que o snap de superfície do desktop é WebGL-only.

## Controles — desktop

- **Botão direito** — seleciona (snap na superfície). **Shift** inverte o modo.
- **Botão esquerdo** — orbita · **roda** — zoom · **botão do meio** — pan
- **Alt+L** — alterna o visualizador de labels

Painel à direita: modo de seleção (aditivo/subtrativo), tamanho do pincel,
limpar/inverter, realce, **transformar a seleção** (mover/rotar/escala/cor +
Aplicar), **exportar** (`.ply` da seleção ou da nuvem inteira), labels (paletas
Paul Tol), visibilidade por splat, carregar `.ply`/`.sog` extra (de
`public/static/assets/splats/`) e o painel **XR**.

## Controles — XR (VR)

Entre por **XR → Entrar em VR** (clique dentro da página, para ter user-activation).
Testar no Quest exige **HTTPS** — exponha o dev server (`host: true` já está
configurado) e use um túnel HTTPS (ex.: ngrok) apontando para a porta 5173.

| Controle | Ação |
|---|---|
| Trigger direito | selecionar (esfera verde = aditivo / vermelho = subtrativo na ponta do raio) |
| Analógico esquerdo | mover no plano |
| Analógico direito X / Y | giro suave / subir-descer |
| A / B (direito) | alterna modo / limpa seleção |
| X / Y (esquerdo) | diminui / aumenta o pincel |

## Edição da seleção

Marque **Editar (preview)**, ajuste mover/rotação/escala/cor (preview ao vivo nos
splats selecionados), **Aplicar** para fixar (empilhável) e **Atualizar pivô** se
mudar a seleção. O **export** reflete as edições.

## Arquitetura

Veja [`ARCHITECTURE.md`](./ARCHITECTURE.md) para o desenho completo: máscara de
seleção, pipeline de edição (similaridade por-splat + edit-list), export PLY,
integração com a engine e XR (seleção por raio + locomoção).
