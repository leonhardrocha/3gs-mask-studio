# 3GS Masking Studio (SuperSplat + VR Tools)

Este workspace integra:

1. SuperSplat (editor de Gaussian Splats)
2. plugin VR de máscara por cone
3. bridge local Node.js para processar o `.ply` exportado
4. página wrapper em `tools/cone-selector/` para carregar splats por URL e controlar seleção fora da UI nativa do SuperSplat

O fluxo é: selecionar em VR -> exportar `.ply` com marcação de opacidade -> enviar para bridge -> executar comando CLI (`splat-transform`) -> gerar arquivo de saída filtrado.

## Estrutura

- `supersplat/`: editor e plugin VR (`src/plugins/mask-tool/`)
- `tools/bridge-server/`: servidor HTTP local para receber/processar o `.ply`
- `tools/cone-selector/`: wrapper HTML + módulo injetável para seleção por cone no SuperSplat
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

2. Configure o modo de execução do CLI.

### Modo recomendado: pipeline em 3 etapas (via `.env`)

```env
# 1) Seleção por volume de cone (mesma ideia do vr-masker)
SELECT_CLI_CMD=node ./scripts/select-cone.mjs --overwrite --input {input} --output {selected}

# Parametrização do cone para testes
# AUTO=true deriva ápice/eixo dos primeiros pontos (garante intersecção no teste)
SELECT_CONE_AUTO_FROM_DATA=true
# Para modo manual: coloque AUTO=false e preencha os campos abaixo
SELECT_CONE_APEX=
SELECT_CONE_AXIS=
SELECT_CONE_ANGLE_DEG=30
SELECT_CONE_RANGE=5

# 2) Limpeza opcional de floaters
MASK_CLI_CMD=node ../../splat-transform/bin/cli.mjs -w {selected} -G 0.05,0.1,0.004 {masked}

# 3) Export final
EXPORT_CLI_CMD=node ../../splat-transform/bin/cli.mjs -w {masked} {output}

MASK_OUTPUT_SUFFIX=_output
MASK_OUTPUT_EXT=.ply
```

### Modo legado: etapa única

```env
MASK_CLI_CMD=node ../../splat-transform/bin/cli.mjs -w {input} -V opacity,gt,0.5 {output}
```

Observações:

- No modo pipeline, os placeholders disponíveis são: `{input}`, `{selected}`, `{masked}`, `{output}`.
- No modo legado, os placeholders obrigatórios são `{input}` e `{output}`.
- Os comandos devem incluir `-w` ou `--overwrite`.
- O bridge escreve temporários em `tools/bridge-server/tmp`.

## Como executar

Abra três terminais.

Antes de rodar qualquer comando Node/npm, confirme o diretório atual em cada terminal.

Comando de verificação (PowerShell):

```powershell
Get-Location
```

Comando de verificação (cmd):

```bat
cd
```

### Terminal 1: Bridge server

Diretório obrigatório: `D:\src\3gs-mask-studio\tools\bridge-server`

```bash
cd tools/bridge-server
npm run start
```

Validação rápida:

```bash
curl http://localhost:3001/health
```

### Terminal 2: SuperSplat

Diretório obrigatório: `D:\src\3gs-mask-studio\supersplat`

```bash
cd supersplat
npm run develop
```

Abra `http://localhost:3000`.

### Terminal 3: Servidor estático do workspace

Diretório obrigatório: `D:\src\3gs-mask-studio`

```bash
npx --yes serve . -p 8080
```

Observações:

- O arquivo `serve.json` na raiz já habilita CORS (`Access-Control-Allow-Origin: *`) para os arquivos servidos em `http://localhost:8080`.
- Isso é necessário para que o SuperSplat em `http://localhost:3000` consiga carregar `sample.ply` e outros `.ply` remotos via `?load=`.
- O comando `npm run develop` existe em `supersplat/package.json`, não na raiz do workspace.

Erros comuns de diretório (e correção):

- Se rodar `npm run develop` na raiz `D:\src\3gs-mask-studio`, vai falhar.
- Correto: primeiro `cd D:\src\3gs-mask-studio\supersplat`, depois `npm run develop`.
- Se rodar `npm run start` fora de `tools/bridge-server`, o bridge pode não subir.
- Correto: `cd D:\src\3gs-mask-studio\tools\bridge-server` e então `npm run start`.

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

## Wrapper integrado (`tools/cone-selector/`)

O wrapper em `tools/cone-selector/index.html` fornece um fluxo sem modificar o código-fonte do SuperSplat:

- sidebar com parâmetros do cone (`apex`, `axis`, `angle`, `range`, `op`)
- campo para URL do splat
- botão `Abrir com splat`, que monta `<SUPERSPLAT_URL>?load=<PLY_URL>`
- comunicação com o iframe do SuperSplat via `window.postMessage`
- envio da seleção ao bridge com `application/octet-stream`

URL de acesso:

```text
http://localhost:8080/tools/cone-selector/index.html
```

Fluxo recomendado:

1. Inicie o bridge em `http://localhost:3001`.
2. Inicie o servidor estático na raiz com `npx --yes serve . -p 8080`.
3. Abra `http://localhost:8080/tools/cone-selector/index.html`.
4. Mantenha a URL padrão do SuperSplat no wrapper: `http://localhost:8080/supersplat/dist/`.
5. Use `Abrir com splat` para carregar, por exemplo, `http://localhost:8080/tools/bridge-server/sample.ply`.

Observações importantes:

- No modo padrão (same-origin em `8080`), o botão `Injetar Cone Selector` injeta automaticamente o módulo no iframe, sem DevTools.
- O parâmetro `?load=` é suportado pelo SuperSplat.

Modo alternativo para desenvolvimento do SuperSplat em tempo real:

- Rode `cd supersplat && npm run develop` para usar `http://localhost:3000`.
- Se trocar a URL do wrapper para `http://localhost:3000`, o iframe volta a ser cross-origin (`3000` vs `8080`).
- Nesse cenário, injeção automática no DOM do iframe é bloqueada pelo navegador e será necessário injetar manualmente no DevTools.

Snippet de injeção manual no Console do DevTools do SuperSplat:

```js
const s = document.createElement('script');
s.type = 'module';
s.src = 'http://localhost:8080/tools/cone-selector/inject.mjs';
document.head.appendChild(s);
```

Depois da injeção, os botões do wrapper passam a funcionar via `postMessage`:

- `Selecionar`
- `Limpar seleção`
- `Enviar ao Bridge`
- `Auto (centro do splat)`

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

---

## Teste manual — App standalone (`app/`)

O app engine-standalone em `app/` pode ser testado sem o SuperSplat.
São necessários dois terminais em paralelo.

### Pré-requisitos

- Node.js 18+
- Bridge configurado (seção **Configuração do Bridge** acima)
- Um arquivo `.ply` / `.splat` acessível via URL (pode ser servido localmente)

### Terminal 1 — Bridge server

```bash
cd tools/bridge-server
npm run start
```

Confirme que está rodando:

```bash
curl http://localhost:3001/health
# esperado: {"ok":true}
```

### Terminal 2 — Servidor estático do app

```bash
npx --yes serve . -p 8080
```

> Serve todo o workspace na raiz. O app fica em `http://localhost:8080/app/`.

### Passo a passo no navegador

1. **Abra sem splat** para verificar que a página carrega sem erros:

   ```
   http://localhost:8080/app/
   ```

   Esperado: canvas preto com mensagem de status "Nenhum splat carregado" (ou similar) no console.

2. **Carregue um splat via query string:**

   ```
   http://localhost:8080/app/?splat=http://localhost:8080/tools/bridge-server/sample.ply
   ```

   O `sample.ply` de exemplo está em `tools/bridge-server/sample.ply`.  
   Esperado: objeto PLY renderizado no canvas.

3. **Simule seleção por cone (fallback de teclado — sem VR):**

   - Pressione e segure **Espaço**: o script executa `_doSelection()` a cada frame.
   - O contador de gaussianas selecionadas deve incrementar no elemento `#selected-count`.
   - Solte **Espaço**: se `autoSendOnStop = true`, o PLY é enviado automaticamente ao bridge.

4. **Verifique o envio ao bridge:**

   No terminal do bridge, deve aparecer um log similar a:

   ```
   POST /process-mask  200
   ```

   A resposta `{ok: true, outputPath: "...", outputBytes: N}` é exibida no console do navegador.

5. **Inspecione o artefato gerado:**

   ```bash
   ls tools/bridge-server/tmp/
   ```

   Deve conter um arquivo `.ply` de saída com apenas as gaussianas selecionadas.

### Teste com WebXR (headset)

1. Acesse `http://localhost:8080/app/` no navegador do headset (ou via HTTPS em rede local).
2. Clique em **Enter VR** (botão renderizado pelo `main.mjs`).
3. Pressione o **trigger** do controlador dominante para selecionar.
4. Solte o trigger para disparar o envio ao bridge.

### Testes automatizados (regressão)

```bash
cd tools/bridge-server
npm run test:bridge-pipeline # contrato do pipeline SELECT/MASK/EXPORT
npm run test:cone-math      # 6 casos — matemática do cone
npm run test:ply-exporter   # 5 casos — contrato do exportador PLY
npm run test:round-trip     # 2 casos — pipeline completo (outputBytes=525, vertexCount=3)
```

Todos devem passar em < 500 ms.

### Verificação manual dos comandos CLI do `.env`

Se quiser validar os comandos sem abrir o app/VR, rode em `tools/bridge-server`:

```powershell
$in='D:\src\3gs-mask-studio\tools\bridge-server\sample.ply'
$sel='D:\src\3gs-mask-studio\tools\bridge-server\tmp\verify-selected.ply'
$mask='D:\src\3gs-mask-studio\tools\bridge-server\tmp\verify-masked.ply'
$out='D:\src\3gs-mask-studio\tools\bridge-server\tmp\verify_output.ply'

node ..\..\splat-transform\bin\cli.mjs -w $in -V opacity_raw,gt,0 $sel
node ..\..\splat-transform\bin\cli.mjs -w $sel -G 0.05,0.1,0.004 $mask
node ..\..\splat-transform\bin\cli.mjs -w $mask $out
```

Esperado: os 3 comandos finalizam com código de saída `0` e os arquivos em `tmp/` são gerados.