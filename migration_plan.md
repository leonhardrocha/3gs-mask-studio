## 📝 migration_plan.md

O sistema de Scripts do PlayCanvas (pc.Script) é, de fato, o "padrão ouro" para estender funcionalidades sem quebrar o núcleo do sistema.

Para responder sua pergunta técnica: Sim, a Engine do PlayCanvas (e consequentemente o Editor) possui suporte nativo completo para Gaussian Splatting, exatamente como descrito no manual que você citou. O SuperSplat, inclusive, é construído usando essas mesmas funções da Engine.

Aqui está como você pode usar essa abordagem de scripts para criar seu plugin de máscara em VR de forma modular:

### Como implementar isso no contexto do SuperSplat:

1. O Suporte a Gaussian Splatting na Engine
Desde a versão 1.65, o PlayCanvas trata Gaussian Splatting como um componente de primeira classe (pc.GSplatComponent).

Ele renderiza os pontos usando shaders altamente otimizados.

Ele gerencia a ordenação (sorting) dos pontos em tempo real para transparência.

Ele expõe a propriedade instance, que contém os buffers que você precisa para extrair o .ply.

2. A Abordagem de Script (Sem alterar o SuperSplat)
Em vez de modificar o código do SuperSplat, você criará um arquivo de script no estilo "Engine". No PlayCanvas, um script é um objeto que se "pendura" em uma Entity e ganha eventos de ciclo de vida como initialize e update.

- Defina o Script: Crie um arquivo vr-masker.js.

- Registre o Script: Use pc.createScript.

- Anexe à Cena: Quando o SuperSplat carregar o modelo, você anexa seu script à entidade que contém o Splat.


3. Por que isso é melhor que mexer no index.ts?
Ao usar o sistema de scripts da Engine dentro do SuperSplat:

- Independência: Seu código de seleção vive em um objeto separado.

- Reuso: Se amanhã você quiser usar essa ferramenta de máscara em um projeto de jogo ou outra aplicação PlayCanvas, o script funcionará da mesma forma.

- Acesso à API de VR: O sistema de scripts tem acesso direto a this.app.xr, que é a API de WebXR da engine, facilitando muito o rastreamento dos controles.

# O Diferencial: O Cálculo do Cone em VR

## Lógica de cálculo do cone e exportação .ply:

```JavaScript
// vr-masker.js - Seu plugin modular
var VrMasker = pc.createScript('vr-masker');

VrMasker.prototype.initialize = function() {
    // Aqui você configura o VR
    this.app.xr.on('start', this.onXrStart, this);
    console.log("Plugin de Máscara VR Inicializado");
};

VrMasker.prototype.update = function(dt) {
    // Se o gatilho estiver pressionado, calcula o cone de seleção
    if (this.isSelecting) {
        this.performConeSelection();
    }
};
```

Para facilitar sua implementação, aqui está a lógica que você deve colocar dentro do update do seu script para a seleção volumétrica:

- Para cada ponto no buffer do Splat, você não quer fazer cálculos pesados toda hora. A abordagem correta é:

- Transformar a posição do ponto para o "Espaço Local" do seu controle VR.

- No espaço local do controle, o eixo do cone é simplificado (geralmente o eixo Z ou Y).

Um ponto está no cone se:

- A distância z estiver entre 0 e alcance_max.

- O raio lateral sqrt(x² + y²) for menor que z * tan(ângulo).

- Essa matemática simplificada no espaço local é muito mais rápida do que usar trigonometria global para milhões de pontos.


Para criar essa ferramenta de forma modular e profissional, vamos dividir o código em três partes: o Script da Engine (que lida com o VR e a seleção), o Utilitário de Exportação (que gera o binário) e o Servidor Ponte (que executa seu CLI).

Aqui estão os arquivos que você deve criar na pasta /src/plugins/mask-tool/ do seu repositório clonado:

1. vr-masker.js (O Coração da Ferramenta)Este script usa a API do PlayCanvas para criar o cone visual e realizar o cálculo matemático de interseção.

```JavaScript // src/plugins/mask-tool/vr-masker.js
var VrMasker = pc.createScript('vr-masker');

VrMasker.attributes.add('coneAngle', { type: 'number', default: 30, title: 'Ângulo do Cone' });
VrMasker.attributes.add('coneRange', { type: 'number', default: 5, title: 'Alcance (Metros)' });

VrMasker.prototype.initialize = function() {
    this.isSelecting = false;
    this.selectedIndices = [];
    
    // Criar um cone visual para feedback no VR
    this.helperCone = this.app.root.findByName('HelperCone') || this.createHelperCone();
    this.helperCone.enabled = false;

    // Escutar eventos de VR
    if (this.app.xr) {
        this.app.xr.on('start', () => console.log("VR Iniciado: Aponte o controle e use o gatilho."));
    }
};

VrMasker.prototype.createHelperCone = function() {
    const entity = new pc.Entity('HelperCone');
    entity.addComponent('render', { type: 'cone' });
    entity.setLocalScale(1, this.coneRange, 1);
    entity.setLocalEulerAngles(-90, 0, 0); // Alinha com o "frente" do controle
    this.app.root.addChild(entity);
    return entity;
};

VrMasker.prototype.update = function(dt) {
    const inputSources = this.app.xr.input.sources;
    if (inputSources.length > 0) {
        const controller = inputSources[0]; // Pega o primeiro controle
        this.helperCone.setPosition(controller.getPosition());
        this.helperCone.setRotation(controller.getRotation());
        
        // Ativar seleção se o gatilho estiver pressionado
        if (controller.buttons[0].pressed) {
            this.helperCone.enabled = true;
            this.processSelection(controller);
        } else if (this.helperCone.enabled) {
            this.helperCone.enabled = false;
            this.exportSelection(); // Exporta ao soltar o gatilho
        }
    }
};

VrMasker.prototype.processSelection = function(controller) {
    const splatEntity = this.app.root.findByName('SplatEntity'); // Nome padrão no SuperSplat
    if (!splatEntity || !splatEntity.gsplat) return;

    const splatData = splatEntity.gsplat.instance.splatData;
    const worldToLocal = controller.getWorldTransform().clone().invert();
    
    const tanAngle = Math.tan(this.coneAngle * Math.PI / 180);
    const newIndices = [];

    // Otimização: Em um app real, use Web Workers para não travar o VR
    for (let i = 0; i < splatData.numVertices; i++) {
        const px = splatData.getProp('x', i);
        const py = splatData.getProp('y', i);
        const pz = splatData.getProp('z', i);
        
        // Transformar ponto para o espaço local do controle
        const localPos = new pc.Vec3(px, py, pz);
        worldToLocal.transformPoint(localPos, localPos);

        // No espaço local do controle (considerando Forward como -Z)
        const zDist = -localPos.z; 
        const radiusAtZ = zDist * tanAngle;
        const radialDist = Math.sqrt(localPos.x * localPos.x + localPos.y * localPos.y);

        if (zDist > 0 && zDist < this.coneRange && radialDist < radiusAtZ) {
            newIndices.push(i);
        }
    }
    this.selectedIndices = [...new Set([...this.selectedIndices, ...newIndices])];
};
```

2. ply-exporter.js (Conversor Binário)Este utilitário pega os índices e cria o arquivo .ply real que o seu CLI entende.

```JavaScript // src/plugins/mask-tool/ply-exporter.js
export function createPlyBuffer(indices, splatData) {
    const header = `ply
format binary_little_endian 1.0
element vertex ${indices.length}
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
end_header\n`;

    const headerBuffer = new TextEncoder().encode(header);
    const vSize = 28; // 7 props * 4 bytes (float32)
    const bodyBuffer = new ArrayBuffer(indices.length * vSize);
    const view = new DataView(bodyBuffer);

    indices.forEach((idx, i) => {
        const offset = i * vSize;
        view.setFloat32(offset + 0, splatData.getProp('x', idx), true);
        view.setFloat32(offset + 4, splatData.getProp('y', idx), true);
        view.setFloat32(offset + 8, splatData.getProp('z', idx), true);
        view.setFloat32(offset + 12, splatData.getProp('f_dc_0', idx), true);
        view.setFloat32(offset + 16, splatData.getProp('f_dc_1', idx), true);
        view.setFloat32(offset + 20, splatData.getProp('f_dc_2', idx), true);
        view.setFloat32(offset + 24, splatData.getProp('opacity', idx), true);
    });

    return new Blob([headerBuffer, bodyBuffer], { type: 'application/octet-stream' });
}
```

3. bridge-server.js (O Servidor Local em Node.js)Este arquivo deve ser rodado fora do navegador (node bridge-server.js). Ele recebe o arquivo e chama seu comando CLI.

```JavaScript // bridge-server.js
const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.raw({ type: 'application/octet-stream', limit: '500mb' }));

app.post('/process-mask', (req, res) => {
    const filename = 'temp_mask.ply';
    fs.writeFileSync(filename, req.body);
    
    console.log(`Recebido: ${req.body.length} bytes. Rodando CLI...`);

    // Altere para o seu comando CLI real
    exec(`meu-conversor-cli --input ${filename} --output mask_output.ply`, (err, stdout, stderr) => {
        if (err) return res.status(500).send(stderr);
        res.send("Textura gerada com sucesso!");
    });
});

app.listen(3000, () => console.log('Ponte iniciada em http://localhost:3000'));
```

### Como Integrar sem quebrar o SuperSplat:Cálculo da Interseção: 

A lógica matemática para o volume do cone está descrita abaixo. É fundamental que você use o espaço local do controle para evitar cálculos de matriz complexos por ponto:$$\text{Ponto está no cone se: } 0 < d_{proj} < h \quad \text{e} \quad \sqrt{x_{local}^2 + y_{local}^2} < d_{proj} \cdot \tan(\theta)$$Onde $d_{proj}$ é a profundidade do ponto em relação ao controle.Injeção Simples: No arquivo index.html do SuperSplat clonado, adicione antes do fechamento do </body>:
```HTML
<script src="src/plugins/mask-tool/vr-masker.js"></script>
<script>
    // Pequeno hook para injetar o script na entidade quando o splat carregar
    window.addEventListener('load', () => {
         const app = pc.Application.getApplication();
         app.on('gsplat:loaded', (entity) => {
             entity.addComponent('script');
             entity.script.create('vr-masker');
         });
    });
</script>
```

Dessa forma, você mantém seu código totalmente separado do núcleo do SuperSplat. Quando você quiser atualizar o SuperSplat com um git pull, seu único trabalho será garantir que o hook no index.html ainda esteja lá.

## Como Integrar sem quebrar o SuperSplat:

### Cálculo da Interseção: 

A lógica matemática para o volume do cone está descrita abaixo. É fundamental que você use o espaço local do controle para evitar cálculos de matriz complexos por ponto:$$\text{Ponto está no cone se: } 0 < d_{proj} < h \quad \text{e} \quad \sqrt{x_{local}^2 + y_{local}^2} < d_{proj} \cdot \tan(\theta)$$Onde $d_{proj}$ é a profundidade do ponto em relação ao controle.Injeção Simples: No arquivo index.html do SuperSplat clonado, adicione antes do fechamento do 

```HTML 
</body>:HTML<script src="src/plugins/mask-tool/vr-masker.js"></script>
<script>
    // Pequeno hook para injetar o script na entidade quando o splat carregar
    window.addEventListener('load', () => {
         const app = pc.Application.getApplication();
         app.on('gsplat:loaded', (entity) => {
             entity.addComponent('script');
             entity.script.create('vr-masker');
         });
    });
</script>
```

Dessa forma, você mantém seu código totalmente separado do núcleo do SuperSplat. Quando você quiser atualizar o SuperSplat com um git pull, seu único trabalho será garantir que o hook no index.html ainda esteja lá.

 A abordagem de nuvem de pontos (Point Cloud) tradicional trata cada ponto como um círculo ou quadrado fixo voltado para a câmera. Já as Gaussianas são elipsoides 3D que se deformam dependendo da perspectiva.Se você usar o código dessa demonstração como base, você estaria basicamente reescrevendo o núcleo de renderização do Gaussian Splatting que já existe nativamente no PlayCanvas.Aqui está a análise de como adaptar essa abordagem e por que ela é mais complexa do que uma nuvem de pontos comum:1. Point Cloud vs. Gaussian SplattingNa demonstração que você citou, o shader geralmente calcula apenas a posição gl_Position e um gl_PointSize. Para Gaussianas, o "ponto" precisa de muito mais informação.CaracterísticaNuvem de Pontos (Demo)Gaussian SplattingGeometriaPontos/Esferas simplesElipsoides anisotrópicos (deformáveis)AtributosXYZ + RGBXYZ + RGB + Opacidade + Rotação (Quat) + EscalaShaderDesenha um círculo/quadradoProjeta uma covariância 3D em uma elipse 2DOrdenaçãoGeralmente ignorada ou via Depth BufferObrigatória (Back-to-front) para transparência2. Como fazer (A Lógica do Shader)Para transformar o shader de nuvem de pontos em um de Gaussian Splatting, você precisaria alterar o Vertex Shader para realizar a "Projeção de EWA" (Elliptical Weighted Average).A Matemática no ShaderEm vez de um tamanho de ponto fixo, você calcula a matriz de covariância $\Sigma$ que define a forma da gaussiana no espaço 3D, e então a projeta para o espaço da tela (2D) usando a matriz da câmera $W$:$$\Sigma' = J W \Sigma W^T J^T$$Onde $J$ é a matriz Jacobiana da projeção. O resultado $\Sigma'$ define como o "ponto" deve ser esticado e rotacionado na tela.No Fragment ShaderEm vez de pintar uma cor sólida, você aplicaria o decaimento gaussiano:OpenGL Shading Language// No fragment shader, a intensidade cai conforme a distância do centro `float power = -0.5 * (u * u + v * v); float alpha = exp(power) * opacity;`

3. O Desafio da Ordenação (Sorting)A maior diferença entre a demo de point cloud e o Splatting é que as Gaussianas exigem transparência acumulada ($A \cdot B \cdot C$). Se você desenhar um ponto atrás de um ponto à frente sem ordenar, a imagem ficará cheia de artefatos.O PlayCanvas resolve isso usando:Web Worker: Ordena os índices dos pontos no fundo enquanto a GPU renderiza.Hardware Instancing: Desenha cada gaussiana como um quad (dois triângulos) que se deforma via shader.Vale a pena seguir essa abordagem da Demo?Se o seu objetivo é aprender como o algoritmo funciona por baixo do capô, sim! É um excelente exercício de álgebra linear e GLSL.No entanto, para o seu projeto de ferramenta de máscara em VR, eu recomendo fortemente não usar a abordagem dessa demo e sim o componente nativo pc.GSplat da Engine.Por que?Performance: O componente nativo já lida com o sorting ultra-rápido e compressão de dados.VR: O suporte a VR no pc.GSplat já trata corretamente a projeção para cada olho (Stereo Rendering), algo que seria muito difícil de calibrar manualmente num shader customizado de point cloud.Como integrar no seu Plugin:Em vez de criar o shader do zero, você pode "pegar carona" no material do SuperSplat:

```JavaScript // Acessando o material que já renderiza as gaussianas
const meshInstance = entity.gsplat.instance.meshInstance;
const material = meshInstance.material;

// Você pode injetar uma variável no shader original para destacar 
// os pontos selecionados pelo seu cone (ex: mudar a cor para vermelho)
material.chunks.APIVar_highlightMask = '... sua lógica de máscara ...';
material.update();
```
lterar o rendering de point cloud para gaussianas, como fazer?

Mudar de uma renderização de Point Cloud para Gaussian Splatting é como passar de desenhar com "bolinhas de gude" para desenhar com "nuvens de spray translúcidas". A complexidade aumenta porque você sai de uma geometria simples e estática para elipses que se deformam conforme a câmera se move.

Se você quer adaptar o código da demonstração de Point Cloud para renderizar Gaussianas, aqui está o roteiro técnico do que você precisa alterar no Shader e no Buffer de Dados:

1. Preparação dos Dados (Buffers)
Um ponto comum só precisa de XYZ e RGB. Uma Gaussiana precisa de muito mais para definir sua forma no espaço:

| Característica | Nuvem de Pontos (Demo) | Gaussian Splatting |
|-----------------|------------------------|--------------------|
| **Geometria** | Pontos/Esferas simples | Elipsoides anisotrópicos (deformáveis) |
| **Atributos** | XYZ + RGB | XYZ + RGB + Opacidade + Rotação (Quat) + Escala |
| **Shader** | Desenha um círculo/quadrado | Projeta uma covariância 3D em uma elipse 2D |
| **Ordenação** | Geralmente ignorada ou via Depth Buffer | Obrigatória (Back-to-front) para transparência |

2. O Vertex Shader: A Transformação de EWA
No Point Cloud, você apenas projeta o ponto. No Gaussian Splatting, você precisa projetar uma elipse. A matemática baseia-se na matriz de covariância Σ.

Construa a Matriz de Escala (S) e Rotação (R) a partir dos atributos.

Calcule a Covariância 3D (Σ):

$$\Sigma' = J W \Sigma W^T J^T$$
 
Projete para o Espaço da Tela: 

Use a matriz da câmera (W) e a matriz Jacobiana (J) da projeção para obter a covariância 2D:
 
No shader, você usará essa matriz $$\Sigma' = J W \Sigma W^T J^T$$ para determinar o tamanho e a inclinação do "quad" (ou ponto expandido) que será desenhado.

3. O Fragment Shader: O Decaimento Gaussiano
Diferente de um ponto sólido, a Gaussiana é transparente nas bordas. No Fragment Shader, você recebe as coordenadas locais do fragmento em relação ao centro do ponto (geralmente variando de -1 a 1).

A intensidade (alpha) é calculada pela função exponencial:

$$G(x) = \exp(-0.5 \cdot (d^T \Sigma'^{-1} d))$$


Onde d é o vetor de distância do pixel ao centro da elipse.

```OpenGL Shading Language
// Exemplo simplificado de Fragment Shader
varying vec2 vUv; // Coordenadas do Quad
varying float vOpacity;

void main() {
    float d = dot(vUv, vUv); // Distância radial
    float alpha = exp(-0.5 * d) * vOpacity;
    
    if (alpha < 0.01) discard; // Otimização para pixels quase invisíveis
    
    gl_FragColor = vec4(vColor, alpha);
}
```

4. O Grande Desafio: Ordenação (Sorting)
Este é o ponto onde a maioria das implementações customizadas falha. No Point Cloud, o Z-Buffer resolve quem está na frente. No Gaussian Splatting, como tudo é translúcido, você precisa desenhar do fundo para a frente (Back-to-Front).

Para adaptar a demo com `example.mjs`:

```Javascript
import files from 'examples/files';
import { rootPath, deviceType } from 'examples/utils';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('application-canvas'));
window.focus();

const gfxOptions = {
    deviceTypes: [deviceType],
    glslangUrl: `${rootPath}/static/lib/glslang/glslang.js`,
    twgslUrl: `${rootPath}/static/lib/twgsl/twgsl.js`
};

const device = await pc.createGraphicsDevice(canvas, gfxOptions);
device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

const createOptions = new pc.AppOptions();
createOptions.graphicsDevice = device;

createOptions.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem];
createOptions.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];

const app = new pc.AppBase(canvas);
app.init(createOptions);

const assets = {
    statue: new pc.Asset('statue', 'container', { url: `${rootPath}/static/assets/models/statue.glb` })
};

const assetListLoader = new pc.AssetListLoader(Object.values(assets), app.assets);
assetListLoader.load(() => {
    // Set the canvas to fill the window and automatically change resolution to be the same as the canvas size
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    // Ensure canvas is resized when window changes size
    const resize = () => app.resizeCanvas();
    window.addEventListener('resize', resize);
    app.on('destroy', () => {
        window.removeEventListener('resize', resize);
    });

    // Create an Entity with a camera component
    const camera = new pc.Entity();
    camera.addComponent('camera', {
        clearColor: new pc.Color(0.1, 0.1, 0.1)
    });
    camera.translate(0, 7, 24);

    // Add entity into scene hierarchy
    app.root.addChild(camera);
    app.start();

    // Create a new Entity
    const entity = assets.statue.resource.instantiateRenderEntity();
    app.root.addChild(entity);

    // Create a new material with a custom shader
    const material = new pc.ShaderMaterial({
        uniqueName: 'MyShader',
        vertexGLSL: files['shader.vert'],
        fragmentGLSL: files['shader.frag'],
        attributes: {
            aPosition: pc.SEMANTIC_POSITION,
            aUv0: pc.SEMANTIC_TEXCOORD0
        }
    });

    // find all render components
    const renderComponents = entity.findComponents('render');

    // for all render components
    renderComponents.forEach((/** @type {pc.RenderComponent} */ render) => {
        // For all meshes in the render component, assign new material
        render.meshInstances.forEach((meshInstance) => {
            meshInstance.material = material;
        });

        // set it to render as points
        render.renderStyle = pc.RENDERSTYLE_POINTS;
    });

    let currentTime = 0;
    app.on('update', (dt) => {
        // Update the time and pass it to shader
        currentTime += dt;
        material.setParameter('uTime', currentTime);

        // Rotate the model
        entity.rotate(0, 15 * dt, 0);
    });
});

export { app };
```

e `control.mjs`:

```Javascript
/**
 * @param {import('../src/app/components/Example.mjs').ControlOptions} options - The options.
 * @returns {JSX.Element} The returned JSX Element.
 */
function controls({ fragment }) {
    return fragment();
}

export { controls };
```

e OpenGL Shaders:

```c OpenGL Fragment Shader // shader.frag
precision lowp float;
varying vec4 outColor;

void main(void)
{
    // just output color supplied by vertex shader
    gl_FragColor = outColor;
}
```

```c OpenGL Vertex Shader // shader.vert
// Attributes per vertex: position
attribute vec4 aPosition;

uniform mat4   matrix_viewProjection;
uniform mat4   matrix_model;

// time
uniform float uTime;

// Color to fragment program
varying vec4 outColor;

void main(void)
{
    // Transform the geometry
    mat4 modelViewProj = matrix_viewProjection * matrix_model;
    gl_Position = modelViewProj * aPosition;

    // vertex in world space
    vec4 vertexWorld = matrix_model * aPosition;

    // use sine way to generate intensity value based on time and also y-coordinate of model
    float intensity = abs(sin(0.6 * vertexWorld.y + uTime * 1.0));

    // intensity smoothly drops to zero for smaller values than 0.9
    intensity = smoothstep(0.9, 1.0, intensity);

    // point size depends on intensity
    // WebGPU doesn't support setting gl_PointSize to anything besides a constant 1.0
    #ifndef WEBGPU
        gl_PointSize = clamp(12.0 * intensity, 1.0, 64.0);
    #endif

    // color mixes red and yellow based on intensity
    outColor = mix(vec4(1.0, 1.0, 0.0, 1.0), vec4(0.9, 0.0, 0.0, 1.0), intensity);
}
```

Você precisará de uma função em JavaScript/C++ (rodando em uma CPU ou Compute Shader) que reordene os índices dos pontos a cada frame, baseada na distância da câmera.

Envie esses índices ordenados para a GPU a cada mudança de ângulo da câmera.

Por que usar a Engine do PlayCanvas em vez de fazer do zero?
A Engine já resolve toda essa matemática pesada:

- Splat Sorting: Já vem com um ordenador em Web Worker (super rápido).

- Instancing: Ela desenha quads deformados de forma muito mais eficiente do que o gl.POINTS.

- SH: Já faz a conversão de Harmônicos Esféricos para RGB linear.

Como aplicar isso agora:
Se você já tem o código de Point Cloud e quer transformá-lo, o caminho mais rápido é substituir o seu pc.Mesh de pontos por um pc.GSplatInstance. Se você realmente quer escrever o shader na mão (pela demo), você terá que trocar o primitive type de pc.PRIMITIVE_POINTS para pc.PRIMITIVE_TRIANGLES (usando instanciamento de quads) para conseguir as elipses deformadas.

# Plano de Migração: Point Cloud para 3DGS Masking

Checklist reestruturado e validado com base nos READMEs de:

- Raiz: `README.md`
- Engine: `engine/README.md`
- SuperSplat: `supersplat/README.md`
- Splat Transform: `splat-transform/README.md`

## Fase 0: Verificação de Base (estado atual)

- [x] Submódulos presentes no workspace (`engine`, `supersplat`, `splat-transform`).
- [x] Comando de bootstrap confirmado: `git submodule update --init --recursive`.
- [x] Divergência de documentação local registrada: a raiz menciona `tools/bridge-server`, pasta ausente no estado atual; correção operacional será implementada na Fase 2.

## Fase 1: Ambiente e Build (sem plugin)

- [x] Instalar dependências do SuperSplat: `npm install` em `supersplat/`.
- [x] Subir SuperSplat conforme README oficial: `npm run develop` em `supersplat/`.
- [x] Validar acesso local do editor em `http://localhost:3000`.
- [x] Instalar dependências da Engine: `npm install` em `engine/`.
- [x] Build base da Engine: `npm run build` em `engine/`.
- [x] Testes da Engine (sanidade): `npm test` em `engine/`.
- [x] Instalar dependências do Splat Transform: `npm install` em `splat-transform/`.
- [x] Testes do Splat Transform: `npm test` em `splat-transform/`.

Observacao operacional: `engine/npm test` usa assets via `localhost:3000`; manter essa porta livre de outros servidores (ex.: SuperSplat) durante a execucao dos testes.

## Fase 2: Ponte Node (Bridge Server)

- [x] Criar pasta `tools/bridge-server/` (alinhando com o README raiz).
- [x] Inicializar servidor HTTP local com CORS e endpoint `POST /process-mask`.
- [x] Implementar recepção binária `application/octet-stream` para `.ply`.
- [x] Integrar execução de CLI via `child_process` com tratamento de erro, timeout e logs.
- [x] Validar fluxo mínimo: receber arquivo, salvar temporário, executar comando e retornar status.

Implementado: comando CLI configuravel por variavel de ambiente `MASK_CLI_CMD`, com suporte a placeholders `{input}` e `{output}`.

## Fase 3: Plugin de Máscara VR no SuperSplat

- [x] Criar `supersplat/src/plugins/mask-tool/vr-masker.ts`.
- [x] Criar `supersplat/src/plugins/mask-tool/ply-exporter.ts`.
- [x] Definir ponto de injeção sem alterar o core da engine (launcher/hook de carregamento do splat).
- [x] Implementar helper visual do cone acoplado ao controle XR.
- [x] Implementar captura de input do controle (pressionar/soltar gatilho).

Progresso 3.1: `vrMasker` registrado no `ToolManager` e integrado ao fluxo de selecao usando fallback por esfera para validar ativacao/eventos antes da intersecao de cone XR.
Progresso 3.2: `ply-exporter` integrado com exportacao em memoria e envio para bridge (`POST /process-mask`) ao finalizar selecao (`select.stop` e `select.once`).

## Fase 4: Seleção Volumétrica e Exportação

- [ ] Implementar teste no espaço local do controle:
    - `0 < z < coneRange`
    - `sqrt(x^2 + y^2) < z * tan(coneAngle)`
- [ ] Acumular índices selecionados sem duplicação.
- [ ] Extrair propriedades mínimas (`x`, `y`, `z`, `f_dc_0..2`, `opacity`).
- [ ] Gerar `.ply` em `binary_little_endian` com cabeçalho consistente.
- [ ] Enviar buffer para a bridge via `fetch`.

## Fase 5: Integração com Splat Transform e pipeline de máscara

- [ ] Substituir CLI placeholder por comando real usando `splat-transform`.
- [ ] Definir contrato de entrada/saída (arquivos temporários, pasta de output, nomes).
- [ ] Encadear pós-processamento para textura/máscara conforme pipeline do projeto.
- [ ] Validar round-trip: VR seleciona -> `.ply` exporta -> bridge processa -> artefato final disponível.

## Fase 6: Performance e Robustez

- [ ] Medir custo por frame da seleção com cena grande (objetivo: evitar stutter em VR).
- [ ] Aplicar estratégia incremental (chunking) ou Worker para seleção em background.
- [ ] Adicionar debounce/janela de atualização para export durante interação contínua.
- [ ] Testar falhas de rede, CLI indisponível e arquivos inválidos.

## Fase 7: Documentação e Entrega

- [ ] Atualizar `README.md` raiz com comandos reais usados no workspace.
- [ ] Documentar setup completo do bridge (`tools/bridge-server`) e variáveis de ambiente.
- [ ] Registrar guia rápido de operação (modo dev, fluxo VR, troubleshooting).
- [ ] Congelar checklist final com critérios de aceite por fase.

---

## Nota de Integração Engine <-> SuperSplat

Para testar mudanças locais da engine no SuperSplat, prefira alias para `engine/src/index.js` (ou build local), em vez de depender apenas do pacote publicado.

Exemplo de direção técnica (ajustar para o bundler atual do SuperSplat):

```javascript
export default {
    resolve: {
        alias: {
            playcanvas: path.resolve(__dirname, '../engine/src/index.js')
        }
    }
};
```