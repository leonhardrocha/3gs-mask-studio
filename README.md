# 3GS Masking Studio (SuperSplat + VR Tools)

Este workspace integra:

1. SuperSplat (editor de Gaussian Splats)
2. plugin VR de máscara por cone
3. bridge local Node.js para processar o `.ply` exportado

O fluxo é: selecionar em VR -> exportar `.ply` com marcação de opacidade -> enviar para bridge -> executar comando CLI (`splat-transform`) -> gerar arquivo de saída filtrado.

## Estrutura

- `supersplat/`: editor e plugin VR (`src/plugins/mask-tool/`)
- `tools/bridge-server/`: servidor HTTP local para receber/processar o `.ply`
- `splat-transform/`: CLI usada no processamento de máscara

## Pre-requisitos

- Node.js 18+
- npm
- Git com submodules
- Navegador com suporte WebXR (para fluxo VR)

## Instalação

1. Inicialize os submódulos:

```bash
git submodule update --init --recursive
```

2. Instale dependências:

```bash
npm install --prefix supersplat
npm install --prefix tools/bridge-server
```

## Configuração do Bridge

1. Use o arquivo de exemplo como base de variáveis de ambiente:

```bash
copy tools\bridge-server\.env.example tools\bridge-server\.env
```

2. Garanta que `MASK_CLI_CMD` esteja configurado (padrão recomendado):

```env
MASK_CLI_CMD=splat-transform -w {input} -V opacity,gt,0.5 {output}
```

Observações:

- `{input}` e `{output}` são placeholders obrigatórios.
- O bridge escreve temporários em `tools/bridge-server/tmp`.

## Como executar

Abra dois terminais.

### Terminal 1: Bridge server

```bash
cd tools/bridge-server
npm run start
```

Validação rápida:

```bash
curl http://localhost:3001/health
```

### Terminal 2: SuperSplat

```bash
cd supersplat
npm run develop
```

Abra `http://localhost:3000`.

## Como ativar e usar o plugin VR

Atualmente o plugin `vrMasker` já está registrado no startup do editor, mas não há botão dedicado na UI padrão para ativá-lo. Para desenvolvimento local, use a ativação forçada durante o boot.

### Ativação forçada (modo dev)

Em `supersplat/src/main.ts`, após o registro do tool `vrMasker`, dispare o evento de ativação:

```ts
toolManager.register('vrMasker', new VrMasker(events, scene));
events.fire('tool.vrMasker');
```

Depois disso, rode novamente `npm run develop`.

## Fluxo de seleção (end-to-end)

1. Inicie bridge e SuperSplat.
2. Carregue um splat no editor e deixe-o selecionado.
3. Entre em VR (ou use fallback de câmera quando sem XR).
4. Pressione e segure o trigger:
   - o plugin atualiza seleção em intervalos (`updateCooldown`)
   - a interseção usa cone: profundidade no eixo + limite radial
5. Solte o trigger:
   - seleção final é aplicada
   - plugin exporta `.ply` com opacidade marcada
   - envia `POST /process-mask` para o bridge
6. O bridge roda o CLI configurado e retorna JSON com `outputPath` e `outputBytes`.

Comportamento de filtro atual:

- selecionado -> `opacity_raw = +100`
- não selecionado -> `opacity_raw = -100`
- filtro CLI -> `opacity,gt,0.5`

## Configuração do plugin

Parâmetros suportados pelo evento `vrMasker.config`:

- `coneAngleDeg`
- `coneRange`
- `op` (`add`, `remove`, `set`)
- `bridgeUrl`
- `autoSendOnStop`

Valores padrão no código:

- `coneAngleDeg = 30`
- `coneRange = 5`
- `op = add`
- `bridgeUrl = http://localhost:3001/process-mask`
- `autoSendOnStop = true`

## Testes recomendados

No bridge server:

```bash
cd tools/bridge-server
npm run test:cone-math
npm run test:ply-exporter
npm run test:round-trip
```

No SuperSplat:

```bash
cd supersplat
npm run lint
```