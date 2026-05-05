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

Atualmente, o **SuperSplat** (versão oficial da PlayCanvas) **não possui suporte nativo a VR/XR habilitado na interface do usuário**. Ele foi desenvolvido focado no uso via mouse/teclado no desktop.

No entanto, como ele utiliza a **PlayCanvas Engine**, o suporte ao WebXR está "escondido" no código. Você pode ativar essa funcionalidade através do seu plugin injetado. Abaixo, apresento a solução técnica para criar um botão de transição e os requisitos de câmera para que o 3DGS seja renderizado corretamente em estéreo (VR).

---

### 1. Desafio Técnico: A Câmera do SuperSplat
Para o VR funcionar, a Engine precisa de uma entidade com um componente `camera`. O SuperSplat gerencia a câmera de forma dinâmica. Para entrar em VR, precisamos garantir que o `pc.XrManager` saiba qual câmera usar para projetar as duas imagens (uma para cada olho).

### 2. Implementação do Botão de Transição (Injeção MJS)
Este script cria um botão na interface e mapeia a tecla **"V"** do teclado para alternar o modo VR.

```javascript
// plugins/vr-toggle.mjs
export class VRTogglePlugin {
    constructor(app) {
        this.app = app;
        this.cameraEntity = this.findActiveCamera();
        this.setupEventListeners();
        this.injectInterface();
    }

    findActiveCamera() {
        // Busca a câmera principal que o SuperSplat está usando
        return this.app.root.findComponent("camera").entity;
    }

    setupEventListeners() {
        // Tecla 'V' para entrar/sair do VR
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'v') {
                this.toggleVR();
            }
        });

        // Monitorar fim da sessão
        this.app.xr.on('end', () => {
            console.log("Sessão VR finalizada");
        });
    }

    injectInterface() {
        // Criar botão na interface do SuperSplat
        const btn = document.createElement('button');
        btn.id = 'vr-button';
        btn.innerHTML = '🕶️ Entrar em VR';
        btn.style = `
            position: absolute;
            bottom: 20px;
            right: 20px;
            z-index: 1000;
            padding: 10px 20px;
            background: #21ce99;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        `;
        
        btn.onclick = () => this.toggleVR();
        document.body.appendChild(btn);
    }

    toggleVR() {
        if (!this.app.xr.active) {
            if (this.app.xr.isAvailable(pc.XRTYPE_VR)) {
                // Inicia a sessão XR
                this.app.xr.start(this.cameraEntity.camera, pc.XRTYPE_VR, pc.XRSPACE_LOCALFLOOR);
            } else {
                alert("VR não disponível ou headset não detectado.");
            }
        } else {
            this.app.xr.end();
        }
    }
}
```

---

### 3. Considerações sobre o Rendering de Gaussianas (3GS) em VR

Ao ativar o VR no SuperSplat, a Engine do PlayCanvas lida com o suporte estéreo automaticamente, mas há detalhes importantes:

* **Stereo Rendering:** A Engine irá renderizar a nuvem de pontos duas vezes (uma para cada olho). Isso dobra a carga da GPU. Como o 3DGS é pesado, certifique-se de que o hardware suporta (ex: RTX 3060+ ou Quest 3 via Link).
* **Depth Sorting:** O PlayCanvas faz o sorting das gaussianas baseado na posição da câmera. No VR, ele usa o ponto central entre os olhos. O efeito de profundidade é nativo e impressionante.
* **Injeção via Entry Point:** Como discutimos, a melhor forma é importar este arquivo no final do `launcher.ts` que você criou.

---

### 4. Por que você não encontra a opção?
O SuperSplat foi projetado como uma ferramenta de **curadoria e limpeza** de dados. Como essas tarefas exigem precisão de clique e manipulação de menus densos, a equipe do PlayCanvas optou por não poluir a UI com controles XR que não possuem ferramentas de edição (gizmos, pincéis) adaptadas para controles espaciais.

### 5. Checklist para Teste
1.  **HTTPS:** O WebXR **só funciona** em `localhost` ou `https`. Se estiver testando em outro dispositivo na rede, use um túnel SSL (como ngrok).
2.  **Headset Conectado:** O botão só funcionará se o navegador detectar um runtime de VR (Oculus App, SteamVR ou WebXR Viewer).
3.  **Permissão de Gatilho:** A chamada `app.xr.start` **deve** estar dentro de um evento de clique (como no código acima) ou não será permitida pelo navegador.

Deseja que eu ajude a integrar a lógica do **Cone de Máscara** diretamente neste botão, para que ao entrar em VR a ferramenta já esteja ativa na mão do usuário?