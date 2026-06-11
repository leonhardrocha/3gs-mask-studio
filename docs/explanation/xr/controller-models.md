# `src/xr/controller-models.mjs` — modelos 3D dos controles (WebXR Input Profiles)

Carrega o **modelo glTF real** de cada controle (via WebXR Input Profiles), o anexa à
entidade do controle (espaço grip) e **anima os botões/gatilho/grip/analógico** a partir do
gamepad — feedback fiel. Também desenha **ícones de ação** sobre os botões.

> Substitui o box de [[controllers]] (mantido como `fallbackBox`). Wiring em [[main]] e [[xr-session]].

## Perfil + modelo

- `fetchProfile(xrInputSource, basePath, defaultProfile)` resolve o perfil WebXR contra os
  assets **vendorizados localmente** em `public/static/webxr-input-profiles/profiles`
  (sem CDN → funciona offline / LAN no headset). `basePath = ${rootPath}/static/...`.
- `new MotionController(xrInputSource, profile, assetPath)` dá os `components` e seus
  `visualResponses`. O glTF (`assetUrl`) é carregado como asset `container` e parenteado ao
  controle; em falha, mantém o `fallbackBox` (nada lança; o motivo é logado).
- O `xrInputSource` bruto vem de `pcInputSource.inputSource` (getter da engine).

## Feedback de botões (`update`)

A cada frame, `motionController.updateFromGamepad()` atualiza os `visualResponses`; para cada:
- **transform** → interpola a transform local do `valueNode` entre `minNode` e `maxNode` pelo `value`;
- **visibility** → liga/desliga o nó.

## Ícones de ação

Pequenos billboards desenhados com **paths de canvas** (não glifos unicode, que podem faltar
na fonte do navegador do Quest): grade = menu (botão **A**), ponto = gatilho, **−** (X),
**+** (Y). Ficam no espaço do controle (escala previsível), posicionados sobre o nó do botão e
**encarando a câmera**. Glifos simétricos sob 180° → imunes a flip. Renderizam na layer
**`UITop`** (ver [[main]]), para não serem ocultados.

## Notas

- Os materiais glTF precisam de **luz** na cena (ambient + headlight em [[main]]) — sem luz
  ficam pretos (foi o que fazia o controle "parecer um paralelepípedo preto").
- A pose `getLocalPosition/Rotation` é o **grip** (espaço em que os modelos são autorados).
