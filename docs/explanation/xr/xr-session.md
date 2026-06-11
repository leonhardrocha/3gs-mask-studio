# `xr/xr-session.mjs` — sessão VR + seleção por raio

**Arquivo:** `src/xr/xr-session.mjs`
**Papel:** entra/sai de VR, gerencia controllers e faz a **seleção por raio** do
controle. É o equivalente XR do [[brush-input]].

Voltar ao índice: [[README]] · Criado por: [[main]] ·
Controllers: [[controllers]] · Locomoção: [[locomotion]] ·
Enfileira em: [[selection-system]]

---

## Colocação do pincel (default robusto)

O pincel fica a uma **distância ajustável ao longo do raio** do controle. Uma esfera
wireframe é desenhada a cada frame na posição do pincel — o raio é o tamanho do
pincel e a cor codifica o modo (**verde = aditivo**, **vermelho = subtrativo**),
dando feedback imediato.

Snap na superfície (`data.xrSnapToSurface`, padrão **off**) é uma sonda de *depth*
via `pc.Picker` ao longo do raio — **experimental** em XR, por isso opt-in (o Picker
se mostrou instável dentro da sessão; ver `ARCHITECTURE.md` §10).

### Controles (grip reservado para navegação)
| Entrada | Ação |
|---|---|
| trigger (direito) | selecionar na esfera (segurar = pincel) |
| A (direito) | alterna aditivo/subtrativo |
| B (direito) | limpa a seleção |
| X/Y (esquerdo) | diminui/aumenta o tamanho do pincel |
| analógicos | locomoção (ver [[locomotion]]) |

---

## Passo a passo

### 1. Setup (linhas 27–44)
- `createLocomotion(...)` → [[locomotion]].
- Câmera auxiliar `pickCam` + `pc.Picker(48, 48, true)` para o snap **opcional**
  (resolução baixa, depth on).
- Temporários reutilizáveis (`brushCenter`, `snappedCenter`, flags `prevA/prevB`...).

### 2. `snap(origin, dir)` (linhas 46–52)
Aponta a `pickCam` na direção do raio e usa `picker.getWorldPointAsync` no **centro**
do buffer (`width>>1, height>>1`) para achar o ponto de superfície ao longo do raio.

### 3. Eventos de XR (linhas 54–73)
Só se `app.xr?.supported`:
- `app.xr.input.on('add')` → cria a entidade de controle ([[controllers]]) e remove
  no `remove`.
- `app.xr.on('start')` → **desabilita o script da câmera** (orbit) para não brigar
  com a pose do HMD; `app.xr.on('end')` → reabilita.

### 4. `enter()` (linhas 75–83)
Valida suporte/disponibilidade e chama:
```js
xr.start(camera.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCALFLOOR, { callback: ... });
```
`XRSPACE_LOCALFLOOR` referencia o piso (origem ao nível do chão). Disparado pelo
evento `enterVR` (botão em [[controls]], conectado em [[main]]).

### 5. `update(dt)` (linhas 85–141) — chamado todo frame por [[main]]
1. Atualiza os controllers e o raio visível ([[controllers]] `updateControllers`).
2. Se a sessão não está ativa, retorna.
3. Pega as fontes preferidas (`right`, `left`) via `getPreferredInputSource`.
4. **Locomoção**: `locomotion.update({ leftSource, rightSource, dt, data })`.
5. Se não há controle direito, retorna (seleção precisa dele).
6. **Botões A/B (direito)** (linhas 102–107): A alterna `selectionMode`, B emite
   `clearSelection`. Detecta borda de subida com `prevA/prevB`.
7. **Tamanho do pincel (X/Y esquerdo)** (linhas 109–114): ajusta `brushSize` com
   `pc.math.clamp`, liberando o analógico direito para girar.
8. **Centro do pincel** (linhas 121–132):
   ```js
   brushCenter.copy(right.getDirection()).mulScalar(dist).add(right.getOrigin()); // distância fixa
   if (data.get('xrSnapToSurface')) { /* throttle 70ms; usa snap se válido */ }
   ```
9. **Esfera de feedback** (linhas 135–136):
   ```js
   const col = mode === SELECT_ADDITIVE ? pc.Color.GREEN : pc.Color.RED;
   app.drawWireSphere(brushCenter, brush, col, 16);   // imediato, por frame
   ```
   `app.drawWireSphere` é uma API de *immediate mode* da engine (desenha sem criar
   entidade; some no frame seguinte se não redesenhar).
10. **Seleção** (linhas 138–140): se `right.selecting` (trigger pressionado),
    `system.queueSelect(brushCenter, brush, mode)` → [[selection-system]].

### 6. `destroy()` (linhas 143–146)
Destrói picker e `pickCam`.

### 7. API retornada (linhas 148–155)
`{ enter, update, destroy, controllers, get active, get supported }`.

---

## Relação com o resto
- A seleção em si é idêntica ao desktop: tudo termina em `system.queueSelect` de
  [[selection-system]] (mesma máscara, mesmo shader).
- `SELECT_ADDITIVE`/`SELECT_SUBTRACTIVE` importados de [[selection-system]].
- O envoltório `try/catch` no `update` está em [[main]] (um erro de frame XR não
  congela o render/HMD).

## Atualizações (sessão atual)

O `update` foi remapeado em torno do [[mode-panel]]:

- **Botão A** (direito) abre/fecha o painel (borda de subida).
- **Painel aberto:** stick esquerdo navega (`navVertical` discreto; horizontal =
  `adjustContinuous` nas linhas numéricas ou troca de modo/ciclo), gatilho `activate`, **B**
  fecha — **locomoção e brush suspensos**.
- **Painel fechado:** locomoção sempre; brush só no modo `select`; **X/Y** (esquerdo)
  diminuem/aumentam o pincel.
- **Snap** agora usa o índice CPU ([[splat-index]]) no lugar do `Picker`: lateral 1:1 no raio,
  só a profundidade suavizada (τ≈0.05 s) + gate de saltos; diagnóstico em `data.snapStats`.
- **Modelos dos controles** ([[controller-models]]) são animados a cada frame (`controllerModels.update()`).
- Bordas de pincelada (gatilho) chamam `system.beginStroke`/`endStroke` (undo de seleção).
