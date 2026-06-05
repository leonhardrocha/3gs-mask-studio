/**
 * Minimal observable key/value store.
 *
 * Replaces the examples-browser `@playcanvas/observer` dependency with a tiny,
 * dependency-free equivalent that exposes exactly the surface the paint app uses:
 *
 *   - `get(key)` / `set(key, value)`           — read/write state
 *   - `on('<key>:set', cb)`                     — react to a value changing
 *   - `on('<event>', cb)` + `emit('<event>')`   — arbitrary app events (e.g. addAsset)
 *
 * Setting a key fires a `"<key>:set"` event with `(newValue, oldValue)`.
 * Keys are flat strings (no nested dot-paths are used by this app).
 */
class Observer {
    /** @type {Map<string, any>} */
    _state = new Map();

    /** @type {Map<string, Set<Function>>} */
    _listeners = new Map();

    get(key) {
        return this._state.get(key);
    }

    set(key, value) {
        const old = this._state.get(key);
        this._state.set(key, value);
        this.emit(`${key}:set`, value, old);
        return value;
    }

    on(event, cb) {
        let set = this._listeners.get(event);
        if (!set) {
            set = new Set();
            this._listeners.set(event, set);
        }
        set.add(cb);
        return this;
    }

    off(event, cb) {
        this._listeners.get(event)?.delete(cb);
        return this;
    }

    emit(event, ...args) {
        const set = this._listeners.get(event);
        if (set) {
            for (const cb of [...set]) {
                cb(...args);
            }
        }
        return this;
    }
}

/** Shared app state, mirroring the `data` observer used by the original example. */
export const data = new Observer();
