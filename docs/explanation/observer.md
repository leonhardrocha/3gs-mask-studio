# `observer.mjs` — store observável (estado global)

**Arquivo:** `src/observer.mjs`
**Papel:** um *key/value store* observável mínimo, sem dependências. É a **fonte
única de estado** do app. Substitui o `@playcanvas/observer` usado no exemplo
original.

Voltar ao índice: [[README]] · Usado por: praticamente todos os módulos —
[[main]], [[controls]], [[selection-system]], [[edit-system]], [[xr-session]]

---

## Superfície da API

A classe `Observer` expõe exatamente o que o app usa:

| Método | O que faz |
|---|---|
| `get(key)` | lê um valor |
| `set(key, value)` | escreve um valor **e** dispara `"<key>:set"` |
| `on(event, cb)` | inscreve um callback num evento |
| `off(event, cb)` | remove um callback |
| `emit(event, ...args)` | dispara um evento arbitrário |

Há **dois tipos de evento**:
1. `"<chave>:set"` — disparado automaticamente por `set` (binding de estado).
2. eventos arbitrários de app — ex. `clearSelection`, `commitEdit`, `exportPly`,
   `enterVR`, `addAsset` — disparados manualmente via `emit`.

---

## Passo a passo

### 1. Estado e listeners (linhas 15–19)

```js
_state = new Map();                  // chave → valor
_listeners = new Map();              // evento → Set<callback>
```

Dois `Map`s. O valor de `_listeners` é um `Set` para evitar callbacks duplicados.

### 2. `get` / `set` (linhas 21–30)

```js
set(key, value) {
    const old = this._state.get(key);
    this._state.set(key, value);
    this.emit(`${key}:set`, value, old);   // ← dispara o evento de mudança
    return value;
}
```

O detalhe central: **todo `set` emite `"<key>:set"`** com `(novo, antigo)`. É isso
que faz o painel ([[controls]]) e os sistemas reagirem a mudanças sem polling.

### 3. `on` (linhas 32–40)

Cria o `Set` do evento sob demanda (*lazy*) e adiciona o callback. Retorna `this`
para encadeamento.

### 4. `off` (linhas 42–45)

```js
this._listeners.get(event)?.delete(cb);
```

Optional chaining: se ninguém nunca se inscreveu nesse evento, não faz nada.

### 5. `emit` (linhas 47–55)

```js
for (const cb of [...set]) cb(...args);
```

Itera sobre uma **cópia** (`[...set]`) — assim um callback pode com segurança
inscrever/desinscrever durante a emissão sem corromper a iteração.

### 6. Instância compartilhada (linha 59)

```js
export const data = new Observer();
```

Um **singleton** exportado. Todos os módulos importam o **mesmo** `data`, então
escrever de um lugar é visto em todos os outros.

---

## Padrão de uso típico

```js
// produtor (UI)
data.set('brushSize', 0.2);

// consumidor (sistema)
data.on('brushSize:set', v => { /* reage */ });

// evento de comando
data.emit('clearSelection');         // disparado pelo botão
data.on('clearSelection', () => system.clear());  // tratado em main
```

As chaves principais do app estão listadas na `ARCHITECTURE.md` §9 e são
inicializadas em [[main]].
