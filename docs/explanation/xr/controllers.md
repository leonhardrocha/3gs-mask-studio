# `xr/controllers.mjs` — proxies de controle + raio

**Arquivo:** `src/xr/controllers.mjs`
**Papel:** cria a entidade visual de cada controle XR (uma caixinha) e desenha o
**raio apontador**. Adaptado do exemplo `lctgs.hands.mjs` da engine (só o caminho de
controllers).

Voltar ao índice: [[README]] · Usado por: [[xr-session]]

---

## Funções exportadas

### `createControllerEntity({ cameraParent, inputSource })` (linhas 13–20)
```js
const entity = new pc.Entity('xr-controller');
entity.addComponent('render', { type: 'box' });
entity.setLocalScale(0.04, 0.04, 0.12);   // caixa fina (12cm de "cano")
cameraParent.addChild(entity);            // filha do RIG, não da câmera
entity.inputSource = inputSource;         // guarda a fonte de input
```
> A entidade é filha do **rig** (`cameraParent`) porque a pose do controle é
> rig-local (igual à câmera; ver [[main]] e [[locomotion]]). Guardar `inputSource`
> no próprio entity simplifica o loop de update.

### `updateControllers({ app, controllers, rayVisible, rayLength })` (linhas 24–41)
Para cada controle:
1. **Pose** (linhas 26–33): se `src.grip` (o controle tem dados de grip/posição),
   habilita a entidade e copia posição/rotação locais (`getLocalPosition/Rotation`);
   senão desabilita.
2. **Raio** (linhas 35–39): se visível e `targetRayMode === XRTARGETRAY_POINTER`,
   calcula o fim do raio e desenha uma linha imediata colorida por ação:
   ```js
   rayEnd.copy(src.getDirection()).mulScalar(rayLength).add(src.getOrigin());
   const color = src.selecting ? pc.Color.GREEN          // trigger (selecionar)
               : (src.squeezing ? pc.Color.CYAN          // grip (navegar, fase 4)
               :  pc.Color.WHITE);                        // ocioso
   app.drawLine(src.getOrigin(), rayEnd, color);
   ```
   `app.drawLine` é *immediate mode* (some no frame seguinte). `rayEnd` é um
   temporário em escopo de módulo (linha 22) para evitar alocação por frame.

### `getPreferredInputSource(controllers, handedness)` (linhas 44–49)
Prefere o controle da mão pedida (`XRHAND_RIGHT` por padrão); se não achar, devolve o
primeiro disponível. Usado por [[xr-session]] para separar mão direita (seleção) da
esquerda (tamanho do pincel / movimento).

---

## Notas
- O `inputSource` expõe `getOrigin()`, `getDirection()`, `getLocalPosition()`,
  `getLocalRotation()`, `selecting` (trigger), `squeezing` (grip), `gamepad`,
  `handedness` e `targetRayMode` — todos providos pela `XrInput` da engine.
- O **raio** é puramente visual aqui; a colocação do pincel ao longo do raio é feita
  em [[xr-session]].

## Atualizações (sessão atual)

`createControllerEntity` foi reestruturado: a entidade é posada (escala 1) no grip e o
**box** virou um **filho** (`entity.fallbackBox`) com sua própria escala — assim a escala do
box não contamina o modelo glTF carregado por [[controller-models]], que parenteia ao lado e
**esconde o box** quando anexa. Sem modelo (perfil indisponível), o box permanece como fallback.
