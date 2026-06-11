/**
 * Undo/redo history — an operation stack (Fase 1).
 *
 * Each entry is a *command*: a `{ label, undo, redo }` triple. Commands carry the
 * minimal data to reverse themselves (e.g. the previous/next values of only the
 * splats an edit touched), so memory is proportional to what changed, not to the
 * scene — the "op-stack" model chosen for this project.
 *
 * Pushing a new command clears the redo stack (standard linear history). The
 * depth is capped; the oldest entries are dropped when exceeded.
 *
 * Observable flags `canUndo` / `canRedo` are mirrored into `data` so the UI can
 * enable/disable controls. Triggered via the `undo` / `redo` events.
 */
export function createHistory({ data, max = 50 } = {}) {
    const undoStack = [];
    const redoStack = [];

    const sync = () => {
        data.set('canUndo', undoStack.length > 0);
        data.set('canRedo', redoStack.length > 0);
    };

    const push = (command) => {
        if (!command) return;
        undoStack.push(command);
        if (undoStack.length > max) undoStack.shift();
        redoStack.length = 0;
        sync();
    };

    const undo = () => {
        const c = undoStack.pop();
        if (!c) return;
        try { c.undo(); } catch (err) { console.error('[history] undo falhou:', err); }
        redoStack.push(c);
        sync();
    };

    const redo = () => {
        const c = redoStack.pop();
        if (!c) return;
        try { c.redo(); } catch (err) { console.error('[history] redo falhou:', err); }
        undoStack.push(c);
        sync();
    };

    const clear = () => {
        undoStack.length = 0;
        redoStack.length = 0;
        sync();
    };

    data.on('undo', undo);
    data.on('redo', redo);
    sync();

    return { push, undo, redo, clear, get canUndo() { return undoStack.length > 0; }, get canRedo() { return redoStack.length > 0; } };
}
