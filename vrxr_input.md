Com base na documentação da **PlayCanvas Engine API**, aqui estão as instruções detalhadas sobre como gerenciar as sessões de VR/XR, utilizar a entrada de mouse para o modo padrão e manipular a entrada de controladores (haptics) no modo XR.

---

### 1. Como Iniciar o VR/XR no Navegador

O gerenciamento de XR no PlayCanvas é feito através do `pc.XrManager`, acessível por `this.app.xr`. O WebXR exige que a sessão seja iniciada a partir de uma **interação do usuário** (ex: clique em um botão).

**Fluxo de ativação:**
1. Verifique se o navegador suporta XR: `app.xr.supported`.
2. Verifique se o tipo de sessão (VR ou AR) está disponível: `app.xr.isAvailable(pc.XRTYPE_VR)`.
3. Inicie a sessão passando uma câmera e o tipo de espaço (ex: local, floor):

```javascript
// Exemplo de ativação por clique
button.on('click', function() {
    if (app.xr.supported && app.xr.isAvailable(pc.XRTYPE_VR)) {
        app.xr.start(cameraEntity.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCALFLOOR);
    }
});
```

---

### 2. Entrada de Mouse (Modo Não-VR)

No modo padrão (2D/3D no navegador), a entrada de mouse é gerenciada pelo objeto `pc.Mouse`, disponível via `this.app.mouse`.

* **Habilitar Mouse:** Certifique-se de que o `pc.Mouse` foi instanciado no seu `pc.Application`.
* **Eventos:** Você pode escutar eventos como `mousedown`, `mouseup` e `mousemove`.
* **Coordenadas:** Para converter o clique do mouse em uma posição 3D, utiliza-se o método `camera.screenToWorld`.

```javascript
// Detectando clique no modo normal
this.app.mouse.on(pc.EVENT_MOUSEDOWN, function (event) {
    console.log("Clique detectado em: " + event.x + ", " + event.y);
}, this);
```

---

### 3. Entrada de Cursor VR e Haptics (Modo VR/XR)

No modo XR, o "cursor" é substituído por instâncias de `pc.XrInputSource`. Você deve monitorar quando controles são adicionados e interagir com eles.

#### Detectando Controles (Cursor VR)
```javascript
this.app.xr.input.on('add', function (inputSource) {
    // O inputSource representa o controle ou a mão
    inputSource.on('select', function () {
        // Ação principal do gatilho (Trigger)
    });
});
```

#### Feedback Háptico (Vibração)
O feedback háptico (vibration) está disponível através da propriedade `gamepad` do `inputSource`. Nem todos os controles suportam, então é necessária uma verificação.

* **API:** `inputSource.gamepad.hapticActuators`.
* **Uso:** Chama-se o método `pulse(intensidade, duracao_ms)`.

```javascript
// Exemplo: Vibrar o controle ao clicar
inputSource.on('selectstart', function() {
    const gamepad = inputSource.inputSource.gamepad;
    if (gamepad && gamepad.hapticActuators && gamepad.hapticActuators.length > 0) {
        // Pulso de 1.0 (máxima força) por 100ms
        gamepad.hapticActuators[0].pulse(1.0, 100);
    }
});
```

---

### 4. Resumo da Lógica de Alternância

Para criar um sistema que suporte ambos, sua lógica deve ser condicional:

| Contexto | Objeto de Entrada | Evento de Seleção | Feedback |
| :--- | :--- | :--- | :--- |
| **Padrão (Mouse)** | `this.app.mouse` | `pc.EVENT_MOUSEDOWN` | Visual/UI |
| **VR (Controles)** | `inputSource` | `'select'` ou `'selectstart'` | Háptico (`pulse`) |

**Dica para Raycasting (Seleção 3D):**
* No **Mouse**, você cria um raio a partir da posição do cursor na tela.
* No **VR**, você usa `inputSource.getOrigin()` e `inputSource.getDirection()` para projetar o raio diretamente da ponta do controle (o cursor VR).