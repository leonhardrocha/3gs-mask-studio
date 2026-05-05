/**
 * bookmarklet.js — Código do bookmarklet para injetar o painel no SuperSplat.
 *
 * Como instalar:
 *   1. Copie o conteúdo do bloco "Bookmarklet one-liner" abaixo.
 *   2. Crie um novo marcador no navegador.
 *   3. Cole o código no campo URL do marcador.
 *   4. Clique no marcador enquanto o SuperSplat está aberto.
 *
 * Pré-requisito:
 *   - O servidor estático (npx serve . -p 8080) deve estar rodando na raiz
 *     do workspace (d:\src\3gs-mask-studio).
 */

// Bookmarklet one-liner (copie e cole como URL de um marcador):
// javascript:(function(){const s=document.createElement('script');s.type='module';s.src='http://localhost:8080/tools/cone-selector/inject.mjs';document.head.appendChild(s);})();

// Versão legível para documentação:
(function () {
    const existing = document.getElementById('cone-selector-panel');
    if (existing) { existing.remove(); return; } // toggle: remove se já injetado
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'http://localhost:8080/tools/cone-selector/inject.mjs';
    document.head.appendChild(s);
})();
