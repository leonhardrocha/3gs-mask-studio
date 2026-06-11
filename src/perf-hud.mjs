/**
 * Baseline performance HUD (Fase 0).
 *
 * A lightweight DOM overlay that reads `app.stats.frame` to surface the metrics
 * that matter for the optimization work:
 *   - FPS / frame ms  → user-facing smoothness (desktop dev proxy).
 *   - gsplats         → splats drawn this frame.
 *   - copy%           → `gsplatBufferCopy`: % of work-buffer blocks RE-RENDERED
 *                       this frame. This is the key signal — Fase 1 (throttle +
 *                       preview-layer) aims to drive its *peak* down. It's GPU-work
 *                       proportional and platform-independent, so it's meaningful
 *                       even when measured on desktop.
 *   - sort ms         → global splat sort (runs every frame in VR; camera moves).
 *
 * Tracks min/avg/max so transient spikes during a brush stroke or edit drag are
 * captured (peak copy% is the number to beat). Keys: `` ` `` toggles, `~` resets
 * the accumulators (call right before a measured action).
 *
 * In-headset FPS: this DOM overlay isn't visible inside VR. For an accurate Quest
 * baseline use OVR Metrics Tool / Meta Quest Developer Hub (zero code, shows
 * FPS/GPU/CPU/stale-frames). The copy% here remains the actionable engine metric.
 */
export function createPerfHud({ app, data = null, visible = true } = {}) {
    const el = document.createElement('div');
    el.id = 'perf-hud';
    el.style.cssText = [
        'position:fixed', 'top:8px', 'left:8px', 'z-index:10000',
        'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'color:#9fe', 'background:rgba(0,0,0,0.62)', 'padding:6px 9px',
        'border:1px solid rgba(120,255,220,0.25)', 'border-radius:6px',
        'white-space:pre', 'pointer-events:none', 'user-select:none',
        'text-shadow:0 1px 1px rgba(0,0,0,0.8)'
    ].join(';');
    document.body.appendChild(el);

    let shown = visible;
    el.style.display = shown ? 'block' : 'none';

    // Rolling accumulators (reset with `~` or resetStats()).
    let frames = 0;
    let msSum = 0;
    let fpsMin = Infinity, fpsMax = 0;
    let copyMax = 0, copySum = 0;
    let sortMax = 0;

    const resetStats = () => {
        frames = 0; msSum = 0;
        fpsMin = Infinity; fpsMax = 0;
        copyMax = 0; copySum = 0; sortMax = 0;
    };

    let lastPaint = 0;

    const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');

    const update = () => {
        const f = app.stats.frame;
        const fps = f.fps;
        const copy = f.gsplatBufferCopy ?? 0;
        const sort = f.gsplatSort ?? 0;

        frames++;
        msSum += f.ms;
        if (fps > 0) { if (fps < fpsMin) fpsMin = fps; if (fps > fpsMax) fpsMax = fps; }
        copySum += copy;
        if (copy > copyMax) copyMax = copy;
        if (sort > sortMax) sortMax = sort;

        // Repaint the DOM at ~6 Hz to avoid layout thrash; stats accumulate every frame.
        const now = performance.now();
        if (!shown || now - lastPaint < 160) return;
        lastPaint = now;

        const avgMs = frames ? msSum / frames : 0;
        const avgCopy = frames ? copySum / frames : 0;
        const draws = app.stats.drawCalls.total;

        let text =
            `FPS ${fmt(fps)}  (min ${fmt(fpsMin)} / max ${fmt(fpsMax)})\n` +
            `ms  ${fmt(f.ms, 1)}  avg ${fmt(avgMs, 1)}\n` +
            `splats ${fmt(f.gsplats)}   draws ${fmt(draws)}\n` +
            `copy% ${fmt(copy, 1)}  avg ${fmt(avgCopy, 1)}  PEAK ${fmt(copyMax, 1)}\n` +
            `sort  ${fmt(sort, 2)}ms  peak ${fmt(sortMax, 2)}`;

        // Snap diagnostics (Fase 1.5), shown only while snapping is active.
        const snap2 = data?.get('snapStats');
        if (snap2) {
            text += `\nsnap depth ${fmt(snap2.depth, 2)}m  jitter ${fmt(snap2.jitter, 3)}  drop ${fmt(snap2.dropout * 100, 0)}%`;
        }
        el.textContent = text;
    };

    app.on('frameend', update);

    const onKey = (e) => {
        if (e.key === '`') { shown = !shown; el.style.display = shown ? 'block' : 'none'; }
        else if (e.key === '~') { resetStats(); }
    };
    window.addEventListener('keydown', onKey);

    const destroy = () => {
        app.off('frameend', update);
        window.removeEventListener('keydown', onKey);
        el.remove();
    };

    return { destroy, resetStats, get visible() { return shown; } };
}
