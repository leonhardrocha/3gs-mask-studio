# `style.css` — estilo do painel e do canvas

**Arquivo:** `src/style.css`
**Papel:** folha de estilo da aplicação. Define o layout em tela cheia do canvas
de render e a aparência do painel lateral construído por [[controls]].

Voltar ao índice: [[README]] · Marcação gerada por: [[controls]]

---

## Seções

### Reset e base (linhas 1–12)
- `* { box-sizing: border-box }` — modelo de caixa previsível.
- `html, body` — ocupa 100% da altura, `overflow: hidden` (sem rolagem da página),
  fundo preto (`#000`) e fonte do sistema. Cor de texto clara (`#e6e6e6`) para o
  tema escuro.

### Canvas de render (linhas 14–21)
```css
#application-canvas { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; }
```
- Preenche a viewport inteira (atrás do painel).
- `touch-action: none` impede o navegador de capturar gestos de toque — eles vão
  para o orbit-camera / brush ([[brush-input]]).
- O id `application-canvas` é o mesmo lido em [[main]]
  (`document.getElementById('application-canvas')`).

### Painel `#controls` (linhas 23–35)
Caixa fixa no canto **direito** (280px), com `overflow-y: auto`, fundo translúcido
e `backdrop-filter: blur(6px)` (efeito de vidro). É o contêiner do painel HTML.

### Classes usadas por [[controls]]
| Classe / seletor | Onde é gerada | Efeito |
|---|---|---|
| `.group` + `.group h2` | `panel(...)` | bloco com borda superior e título em maiúsculas azuladas |
| `.row` / `.row-label` | `row(...)` | linha flex rótulo↔controle |
| `.slider` / `.slider output` | `slider`/`boundSlider` | slider + leitura numérica alinhada |
| `input[type=range]` | sliders | largura fixa 120px |
| `input[type=color]` | seletores de cor | swatch 40×24 |
| `select`, `input[type=text]` | selects/campos | estilo escuro |
| `button` / `button:hover` | botões | botão azul de largura total |
| `.visibility-list .empty` | lista de visibilidade | texto "nenhum asset" |
| `.add-asset` | painel "Carregar Asset" | coluna campo + botão |

> Observação: o CSS define também `.panel-title` e `.hint`, classes auxiliares para
> cabeçalhos/dicas no HTML estático (`index.html`); o painel dinâmico de [[controls]]
> usa principalmente `.group`/`.row`.
