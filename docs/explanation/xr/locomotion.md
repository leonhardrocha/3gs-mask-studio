# `xr/locomotion.mjs` — navegação pelo mundo (move o rig)

**Arquivo:** `src/xr/locomotion.mjs`
**Papel:** locomoção em VR pelos analógicos. **Move o rig** (`cameraParent`), nunca a
câmera — porque a engine escreve a pose do HMD na câmera.

Voltar ao índice: [[README]] · Criado por: [[xr-session]] · Rig montado em: [[main]]

---

## Esquema de controle (sem conflito com o pincel)

| Analógico | Eixo | Ação |
|---|---|---|
| Esquerdo | Y | frente/trás (na direção da cabeça, horizontal) |
| Esquerdo | X | *strafe* (lateral) |
| Direito | X | giro contínuo suave (*yaw*) em torno da cabeça |
| Direito | Y | vertical (sobe/desce) |

> O analógico direito é **só movimento** (não controla o pincel), evitando
> conflito. Manipulação de mundo por "agarrar" (grip) está fora de escopo
> (`ARCHITECTURE.md` §10) — o grip fica livre para uma fase futura.

---

## Passo a passo

### 1. Temporários + constantes (linhas 15–23)
Vetores/quaternion reutilizáveis (`fwd`, `right`, `move`, `head`, `offset`,
`turnQuat`). `TURN_SPEED = 90` °/s; `DEADZONE = 0.15` (ignora drift do analógico).

### 2. `yaw(angleDeg)` (linhas 26–33) — girar em torno da cabeça
```js
head.copy(camera.getPosition());                       // H = posição da cabeça (mundo)
offset.copy(cameraParent.getPosition()).sub(head);     // P − H
turnQuat.setFromEulerAngles(0, angleDeg, 0);
turnQuat.transformVector(offset, offset);              // R·(P − H)
cameraParent.setPosition(head + offset);               // P' = H + R·(P − H)
cameraParent.rotate(0, angleDeg, 0);
```
> Gira o **rig** em torno da posição **da cabeça**, não da origem do rig. Sem isso, o
> mundo "orbitaria" longe do jogador. É a fórmula de rotação em torno de um ponto.

### 3. `update({ leftSource, rightSource, dt, data })` (linhas 35–65)
Chamado por [[xr-session]] todo frame.

`speed = (data.xrMoveSpeed ?? 1.5) * dt` — velocidade independente de framerate.

**Analógico esquerdo — movimento planar** (linhas 39–55):
```js
fwd.copy(camera.forward); fwd.y = 0; fwd.normalize();   // frente projetada no plano
right.copy(camera.right); right.y = 0; right.normalize();
move.set(fwd.x*(-ly) + right.x*lx, 0, fwd.z*(-ly) + right.z*lx);
cameraParent.translate(move * speed);
```
Usa a orientação **da cabeça** (`camera.forward/right`) projetada no plano horizontal
(`y = 0`) — andar é relativo a para onde você olha, mas sem subir/descer. `axes[2]` =
X, `axes[3]` = Y (convenção do gamepad XR). `-ly` porque para frente é Y negativo.

**Analógico direito — giro + vertical** (linhas 57–64):
```js
if (Math.abs(rx) > DEADZONE) yaw(-rx * TURN_SPEED * dt);            // X = yaw suave
if (Math.abs(ry) > DEADZONE) cameraParent.translate(0, -ry*speed, 0); // Y = vertical
```

### 4. API retornada (linha 67)
`{ update }`.

---

## Por que mexer no rig e não na câmera?
Em XR a engine sobrescreve a transformação **local** da câmera com a pose do HMD a
cada frame. Qualquer movimento aplicado direto na câmera seria apagado. Por isso o
mundo é movido transformando o **pai** (`cameraParent`), montado em [[main]]. Mesma
razão pela qual [[xr-session]] desabilita o script orbit-camera ao entrar em VR.
