# README_PLUGIN

## Objetivo

Este documento descreve a transicao do modelo antigo de injecao de logica XR para um modelo de plug-in PlayCanvas baseado em Script Component (`pc.createScript` / `pc.registerScript`) e explica como inicializar esse plug-in no editor do SuperSplat.

Commit de referencia: `4960756` na branch `plugin-refactor`.

---

## Como iniciar o SuperSplat (comandos)

O fluxo abaixo sobe tudo o que o plugin precisa para funcionar no editor do SuperSplat e no wrapper `cone-selector`.

### Terminal 1 - Bridge server

```powershell
cd d:\src\3gs-mask-studio\tools\bridge-server
npm install
npm start
```

### Terminal 2 - SuperSplat

Se for a primeira vez:

```powershell
cd d:\src\3gs-mask-studio\supersplat
npm install
```

Para desenvolvimento com rebuild automatico:

```powershell
cd d:\src\3gs-mask-studio\supersplat
npm run watch
```

Se quiser apenas gerar o `dist` uma vez:

```powershell
cd d:\src\3gs-mask-studio\supersplat
npm run build
```

### Terminal 3 - Servidor estatico do workspace

Este servidor expoe a raiz do repositorio para que o wrapper encontre `supersplat/dist/` e `tools/cone-selector/inject.mjs` no mesmo origin.

```powershell
cd d:\src\3gs-mask-studio
npx serve -l 8080 .
```

### URLs para abrir

- Wrapper do cone selector: `http://localhost:8080/tools/cone-selector/index.html`
- SuperSplat buildado: `http://localhost:8080/supersplat/dist/`
- Bridge server: `http://localhost:3001/process-mask`

---

## O que foi implementado

### 1) Novo plug-in VR modular

Arquivo novo:
- `app/scripts/vr-studio-plugin.mjs`

Implementacao principal:
- Classe `VrStudioPlugin` (script name: `vrStudio`).
- Atributos configuraveis:
  - `speed`
  - `coneAngle`
  - `coneRange`
- Ciclo de vida nativo da engine:
  - `initialize()`:
    - prepara camera rig (`XRRig`)
    - registra eventos de XR start/end
    - injeta botao de VR na toolbar quando disponivel
    - registra hotkeys (`Alt+V`)
  - `update(dt)`:
    - controlador direito: pose/trigger/clear/cycle-op
    - controlador esquerdo: locomocao do rig
- API publica:
  - `startSession(type, space)`
  - `endSession()`
  - `toggleVR()`
- Bootstrap helper exportado:
  - `initVRPlugin(app)`

### 2) Bootstrap no app standalone

Arquivo alterado:
- `app/main.mjs`

Mudancas:
- Importa e registra o plug-in com `initVRPlugin(app)`.
- Cria entidade global `VRPluginManager` com componente script.
- Instancia `vrStudio` com atributos iniciais.
- Botao de VR passa a delegar para `plugin.startSession()` quando o plugin esta pronto.

### 3) Integracao no fluxo inject do SuperSplat

Arquivo alterado:
- `tools/cone-selector/inject.mjs`

Mudancas:
- Adicionada funcao `bootstrapVrPlugin()` dentro do contexto da pagina do SuperSplat.
- Adicionado retry `tryBootstrapVrPlugin()` para inicializacao robusta apos load da app.
- `injectPanel()` agora:
  - inclui `#cs-vr-status`
  - chama `tryBootstrapVrPlugin()` ao final
- Loop RAF legado:
  - quando `VRPluginManager` existe, o branch XR legado e ignorado
  - controle XR passa para `plugin.update(dt)`

---

## Arquitetura final (resumo)

- O plugin e registrado na engine como script (`vrStudio`).
- Uma entidade global `VRPluginManager` instancia e mantem o plugin.
- O plugin usa o loop oficial da engine (`update(dt)`), eliminando dependencia de RAF manual para XR.
- O `inject.mjs` permanece como ponto de entrada pratico no SuperSplat, mas a logica XR fica encapsulada no plugin.
- O ponto de verdade do estado do VR e a cena: `VRPluginManager` e a instancia do script na arvore da cena.
- O HTML e apenas a camada de entrada da interface; o botao injetado no DOM e conveniente, mas nao substitui o bootstrap na cena.

### Cena x HTML

Se a duvida for "o plugin deveria adicionar algo na propriedade da cena em vez de no HTML?", a resposta pratica e: **sim, o estado e o lifecycle do plugin devem estar na cena**.

- Na cena: `VRPluginManager` com o script `vrStudio`.
- No HTML: apenas comandos de acesso, atalhos e botao visual para o usuario acionar o plugin.
- No SuperSplat: a UI pode ser injetada no DOM, mas ela e secundaria. O comportamento real vem da entidade da cena.

---

## Como inicializar o plug-in no editor do SuperSplat

Existem dois cenarios: 

### A) Inicializacao via cone-selector (recomendado para uso imediato)

1. Inicie o bridge server, o SuperSplat e o servidor estatico da raiz usando os comandos acima.
2. Abra a pagina wrapper:
   - `tools/cone-selector/index.html`
3. O wrapper injeta `tools/cone-selector/inject.mjs` no iframe do SuperSplat.
4. O `inject.mjs` chama `tryBootstrapVrPlugin()` automaticamente.
5. Quando `window.scene.app` estiver pronto:
   - cria-se `VRPluginManager`
   - instancia-se `script.create('vrStudio', { attributes: ... })`
6. Acione VR por:
   - botao `Entrar em XR (VR)` no painel
   - hotkey `Alt+V`
   - botao `🕶️` na `#bottom-toolbar` (quando toolbar estiver presente)

Validacao rapida no DevTools do iframe:

```js
window.scene?.app?.root?.findByName('VRPluginManager')
```

Se retornar entidade, o plugin esta ativo.

### Validacao tecnica (passos 1 a 3)

Use esta sequencia no DevTools da pagina do SuperSplat (na aba correta):

1. Injecao com cache-buster:

```js
const s = document.createElement('script');
s.type = 'module';
s.src = 'http://localhost:8080/tools/cone-selector/inject.mjs?t=' + Date.now();
document.head.appendChild(s);
```

2. Verificacao da entidade na cena:

```js
window.scene?.app?.root?.findByName('VRPluginManager')
```

3. Verificacao do modo de runtime do plugin:

```js
window.__vrStudioPlugin
```

Resultados esperados:

- Modo padrao (com `window.pc`): `VRPluginManager` presente e script `vrStudio` ativo.
- Modo fallback funcional (sem `window.pc`):
  - `VRPluginManager` presente
  - `window.__vrStudioPlugin.mode === 'fallback-functional'`

### B) Inicializacao manual no editor SuperSplat (DevTools)

Se quiser iniciar sem o wrapper:

1. Abra o SuperSplat no browser.
2. No DevTools, injete o modulo:

```js
const s = document.createElement('script');
s.type = 'module';
s.src = 'http://localhost:8080/tools/cone-selector/inject.mjs';
document.head.appendChild(s);
```

3. O proprio `inject.mjs` executa `injectPanel()` e faz bootstrap do plugin.

### Fluxo visual na interface

1. Abra o wrapper `cone-selector`.
2. Clique em `Injetar Cone Selector`.
3. Aguarde o painel aparecer no canto direito.
4. Clique em `Entrar em XR (VR)` ou pressione `Alt+V`.
5. Confirme que `VRPluginManager` existe no DevTools do iframe.
6. Em XR, use o controle direito para pose/selecao e o esquerdo para locomocao.

---

## Eventos e interacao do plugin no SuperSplat

No contexto inject, o plugin atualiza diretamente:
- `previewState` (apex/eixo em pose XR)
- selecao por trigger (`applySelectionFromPreview()`)
- limpar selecao (`#cs-clear`)
- ciclo de operacao (`cycleOperationMode()`)
- locomocao (`moveObserverByLeftStick()`)

Isso preserva o comportamento da ferramenta existente, mas com lifecycle nativo da engine.

---

## Observacoes importantes

- O plugin depende de `window.scene.app.xr` estar disponivel no build em execucao.
- Em navegadores sem WebXR/runtime ativo, `startSession()` falhara com mensagem de indisponibilidade.
- Quando `window.pc` nao existe no runtime ESM do SuperSplat, o `inject.mjs` ativa fallback funcional completo via `app.on('update')`.
- No fallback funcional:
  - `VRPluginManager` e criado na cena
  - hotkey `Alt+V` continua ativa
  - update de XR (mira/selecao/locomocao) roda sem `pc.createScript`
- O branch XR legado no RAF permanece como fallback de seguranca quando nenhum modo de plugin estiver ativo.
- A selecao por cone continua no fluxo existente e o plugin assume principalmente XR/session/navigation/input dispatch.

---

## Proximos passos recomendados

1. Migrar 100% do branch XR legado para plugin (remover fallback RAF quando estabilizado em todos os runtimes).
2. Padronizar dispatch de eventos (`xr:pose`, `xr:trigger`, etc.) entre standalone e inject.
3. Consolidar uma unica implementacao do plugin compartilhada por `app/` e `tools/cone-selector/`.
