// Stacked, thin uPlot charts sharing one time axis.
//
// Touch model (one code path for mouse, pen and finger, via Pointer Events):
//   - one pointer dragging across any chart scrubs a crosshair through every
//     chart in the stack; the values show in a sticky readout row (not a
//     tooltip under the finger). The crosshair stays where it was left.
//   - two pointers pinch/pan the shared x range. Mouse wheel zooms too.
//   - vertical swipes still scroll the page (touch-action: pan-y).
import uPlot from './uplot.js';
import { local, midnights, hourLabel, dayLabel, dateLabel } from './time.js';
import { nights } from './sun.js';

export const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function alpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const Y_SIZE = 38;   // every y axis the same width so plots line up
const X_SIZE = 22;
const FONT = `11px ${getComputedStyle(document.documentElement).getPropertyValue('--font-ui') || 'system-ui'}`;

/** x-axis ticks on local hour boundaries, spaced for the pixels available. */
function xSplits(u, _i, min, max) {
  const pxPerHour = u.bbox.width / devicePixelRatio / ((max - min) / 3600);
  const step = [1, 2, 3, 6, 12, 24, 48, 72, 168].find(h => h * pxPerHour >= 44) ?? 336;
  const out = [];
  if (step < 24) {
    for (let t = Math.ceil(min / 3600) * 3600; t <= max; t += 3600) if (local(t).h % step === 0) out.push(t);
  } else {
    const days = step / 24;
    for (const t of midnights(min, max)) if (Math.round(t / 86400) % days === 0) out.push(t);
  }
  return out;
}
const xValues = (u, splits) => {
  const span = (u.scales.x.max - u.scales.x.min) / 3600;
  const pxPerHour = u.bbox.width / devicePixelRatio / span;
  return splits.map(t => local(t).h !== 0 ? hourLabel(t) : pxPerHour * 24 >= 70 ? dayLabel(t) : dateLabel(t));
};

/** Night shading, midnight separators, "now", day names (first chart). */
function backdrop(ctx) {
  return {
    hooks: {
      drawClear: u => {
        const c = u.ctx, { left, top, width, height } = u.bbox;
        const { min, max } = u.scales.x;
        c.save();
        c.beginPath(); c.rect(left, top, width, height); c.clip();
        if (ctx.lat != null) {
          c.fillStyle = ctx.colors.night;
          for (const [s, e] of nights(min, max, ctx.lat, ctx.lon)) {
            const a = u.valToPos(Math.max(s, min), 'x', true), b = u.valToPos(Math.min(e, max), 'x', true);
            c.fillRect(a, top, b - a, height);
          }
        }
        c.fillStyle = ctx.colors.midnight;
        const lw = Math.max(1, Math.round(devicePixelRatio));
        if (width / devicePixelRatio / ((max - min) / 86400) >= 24)
          for (const t of midnights(min, max)) c.fillRect(Math.round(u.valToPos(t, 'x', true)), top, lw, height);
        c.restore();
      },
      draw: u => {
        const c = u.ctx, { left, top, width, height } = u.bbox;
        const { min, max } = u.scales.x;
        const dpr = devicePixelRatio;
        c.save();
        c.beginPath(); c.rect(left, top, width, height); c.clip();
        if (ctx.now && ctx.now > min && ctx.now < max) {
          c.fillStyle = alpha(ctx.colors.now, 0.8);
          const x = Math.round(u.valToPos(ctx.now, 'x', true));
          c.fillRect(x, top, Math.max(1, Math.round(dpr)), height);
        }
        if (u._dayLabels) {
          c.font = `600 ${11 * dpr}px ${FONT.split('px ')[1]}`;
          c.fillStyle = ctx.colors.dim;
          c.textBaseline = 'top';
          c.textAlign = 'left';
          const pxDay = width / ((max - min) / 86400);
          if (pxDay >= 34) {
            const ms = midnights(min - 86400 * 2, max);
            for (const t of ms) {
              const x = Math.max(left, u.valToPos(t, 'x', true));
              const next = u.valToPos(t + 86400, 'x', true);
              if (next - x < (t < min ? 90 : 30) * dpr) continue;
              c.fillText(pxDay >= 70 ? `${dayLabel(t + 43200)} ${dateLabel(t + 43200)}` : dayLabel(t + 43200), x + 4 * dpr, top + 3 * dpr);
            }
          }
        }
        c.restore();
      },
    },
  };
}

/**
 * Build a stack of charts in `el`.
 * opts: {charts: [{title, legend, height, data, series, y, dayLabels, plugins}],
 *        lat, lon, now, step, xMin, xMax, minSpan, range: [a, b],
 *        onCursor(t), onRange(a, b)}
 * Returns {setRange, setCursor, range, destroy}.
 */
export function createStack(el, opts) {
  el.textContent = '';
  const colors = {
    night: css('--night'), midnight: css('--midnight'), now: css('--accent'), dim: css('--text-faint'),
    grid: css('--grid'), axis: css('--text-faint'), ref: css('--ref'), bg: css('--chart-bg'),
  };
  const ctx = { colors, lat: opts.lat, lon: opts.lon, now: opts.now };
  const step = opts.step ?? 3600;
  let [rMin, rMax] = opts.range;
  let cursorT = opts.cursor ?? null;
  const plots = [];

  const width = () => Math.max(200, el.clientWidth);

  opts.charts.forEach((spec, i) => {
    const last = i === opts.charts.length - 1;
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    const head = document.createElement('div');
    head.className = 'chart__head';
    const title = document.createElement('span');
    title.className = 'chart__title';
    title.textContent = spec.title;
    head.append(title);
    if (spec.legend?.length) {
      const lg = document.createElement('span');
      lg.className = 'chart__legend';
      for (const l of spec.legend) {
        const s = document.createElement('span');
        const k = document.createElement('i');
        k.className = `key${l.kind ? ' key--' + l.kind : ''}`;
        k.style.color = l.color;
        if (l.kind === 'area') k.style.background = l.color;
        s.append(k, document.createTextNode(l.label));
        lg.append(s);
      }
      head.append(lg);
    }
    const plotEl = document.createElement('div');
    plotEl.className = 'chart__plot';
    wrap.append(head, plotEl);
    el.append(wrap);

    const yAxis = {
      size: Y_SIZE, stroke: colors.axis, font: FONT, gap: 4,
      grid: { stroke: colors.grid, width: 1 }, ticks: { show: false },
      space: spec.ySpace ?? 22,
      values: spec.yValues,
      splits: spec.ySplits,
    };
    const xAxis = last
      ? { size: X_SIZE, stroke: colors.axis, font: FONT, gap: 3, grid: { show: false }, ticks: { show: true, stroke: colors.grid, size: 3 }, splits: xSplits, values: xValues }
      : { show: false };

    const u = new uPlot({
      width: width(),
      height: spec.height + (last ? X_SIZE : 0),
      padding: [4, 12, last ? 0 : 2, 0],
      legend: { show: false },
      select: { show: false },
      cursor: {
        x: true, y: false,
        drag: { x: false, y: false, setScale: false },
        focus: { prox: -1 },
        // We drive the cursor ourselves (see below); disable uPlot's mouse binding.
        bind: { mousedown: () => null, mouseup: () => null, click: () => null, dblclick: () => null, mousemove: () => null, mouseleave: () => null, mouseenter: () => null },
        points: { ...(spec.cursorPoints === false ? { show: false } : {}), size: 7, width: 2, fill: (u, si) => u.series[si]._stroke ?? u.series[si].stroke, stroke: colors.bg },
      },
      scales: { x: { time: false, min: rMin, max: rMax }, y: spec.y ?? {} },
      axes: [xAxis, yAxis],
      series: [{}, ...spec.series],
      plugins: [backdrop(ctx), ...(spec.plugins ?? [])],
    }, spec.data, plotEl);
    u._dayLabels = !!spec.dayLabels;
    plots.push(u);
  });

  // ---- shared cursor & range ----
  function setCursor(t) {
    cursorT = t;
    for (const u of plots) {
      if (t == null || t < u.scales.x.min || t > u.scales.x.max) u.setCursor({ left: -10, top: -10 });
      else u.setCursor({ left: u.valToPos(t, 'x'), top: 8 });
    }
    opts.onCursor?.(t);
  }
  function setRange(a, b, quiet) {
    const lo = opts.xMin, hi = opts.xMax;
    let span = Math.min(Math.max(b - a, opts.minSpan ?? 6 * 3600), hi - lo);
    a = Math.min(Math.max(a, lo), hi - span);
    rMin = a; rMax = a + span;
    for (const u of plots) u.batch(() => u.setScale('x', { min: rMin, max: rMax }));
    if (cursorT != null) setCursor(cursorT);
    if (!quiet) opts.onRange?.(rMin, rMax);
  }
  const snap = opts.snap ?? (v => Math.round((v - opts.xMin) / step) * step + opts.xMin);

  // ---- pointer handling, on every plot's overlay ----
  const pointers = new Map();
  let pinch = null;
  for (const u of plots) {
    const over = u.over;
    const valAt = clientX => { const r = over.getBoundingClientRect(); return u.posToVal(clientX - r.left, 'x'); };
    const scrub = clientX => {
      const r = over.getBoundingClientRect();
      const left = Math.min(Math.max(clientX - r.left, 0), r.width);
      setCursor(Math.min(Math.max(snap(u.posToVal(left, 'x')), opts.xMin), opts.xMax));
    };
    const startPinch = () => {
      const [p1, p2] = [...pointers.values()];
      pinch = { v1: valAt(p1.x), v2: valAt(p2.x) };
    };
    over.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, { x: e.clientX, u });
      try { over.setPointerCapture(e.pointerId); } catch {}
      if (pointers.size === 1) scrub(e.clientX);
      else if (pointers.size === 2) startPinch();
    });
    over.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && e.buttons === 0) scrub(e.clientX); // hover
        return;
      }
      pointers.get(e.pointerId).x = e.clientX;
      if (pointers.size === 2 && pinch) {
        const r = over.getBoundingClientRect();
        const [p1, p2] = [...pointers.values()];
        let x1 = p1.x - r.left, x2 = p2.x - r.left, v1 = pinch.v1, v2 = pinch.v2;
        if (Math.abs(x2 - x1) < 24 || v1 === v2) return;
        const span = (v2 - v1) * r.width / (x2 - x1);
        if (span <= 0) return;
        setRange(v1 - x1 / r.width * span, v1 - x1 / r.width * span + span);
      } else if (pointers.size === 1) {
        scrub(e.clientX);
      }
    });
    const end = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 2) startPinch();
    };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);
    over.addEventListener('wheel', e => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX) && !e.shiftKey) {
        // horizontal wheel/trackpad: pan
        e.preventDefault();
        const dv = e.deltaX / over.clientWidth * (rMax - rMin);
        setRange(rMin + dv, rMax + dv);
        return;
      }
      if (!e.ctrlKey && !e.altKey) return; // plain wheel scrolls the page
      e.preventDefault();
      const v = valAt(e.clientX), k = Math.exp(e.deltaY * 0.002);
      setRange(v - (v - rMin) * k, v + (rMax - v) * k);
    }, { passive: false });
  }

  const ro = new ResizeObserver(() => {
    const w = width();
    for (const u of plots) if (Math.abs(u.width - w) > 1) u.setSize({ width: w, height: u.height });
    if (cursorT != null) setCursor(cursorT);
  });
  ro.observe(el);

  if (cursorT != null) requestAnimationFrame(() => setCursor(cursorT));

  return {
    plots,
    setRange,
    setCursor,
    get range() { return [rMin, rMax]; },
    get cursor() { return cursorT; },
    destroy() { ro.disconnect(); for (const u of plots) u.destroy(); el.textContent = ''; },
  };
}

/** Bars path builder (uPlot's), thin with rounded value-ends. */
export const bars = (size = 0.78, max = 24) => uPlot.paths.bars({ size: [size, max], radius: 0.2, align: 0, gap: 2 });

/** A horizontal reference line at value v on scale 'y' (only when in range). */
export function refLines(values, color, labelFmt) {
  return {
    hooks: {
      drawClear: u => {
        const c = u.ctx, { left, width } = u.bbox, { min, max } = u.scales.y;
        c.save();
        for (const v of values) {
          if (v < min || v > max) continue;
          const y = Math.round(u.valToPos(v, 'y', true));
          c.fillStyle = color;
          c.fillRect(left, y, width, Math.max(1, Math.round(devicePixelRatio)));
          if (labelFmt) {
            c.font = `${10 * devicePixelRatio}px system-ui`;
            c.textAlign = 'right'; c.textBaseline = 'bottom';
            c.fillText(labelFmt(v), left + width - 3 * devicePixelRatio, y - 1 * devicePixelRatio);
          }
        }
        c.restore();
      },
    },
  };
}
