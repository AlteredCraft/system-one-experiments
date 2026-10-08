/* Shared by the results pages: tooltips, the scoreboard, the latency lanes,
   chart scales, the side contents with the reading-progress bar, and
   redrawing charts on resize.
   Load it after the page's #tip element and before the page's own script. */

window.S1X = (function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const f2 = (x) => x.toFixed(2);
  const mColor = (run) => `var(--m-${run.id})`;
  const swatch = (run) => `<span class="sw" style="--c:${mColor(run)}"></span>`;

  /* ---------- tooltip: any element with data-tip ---------- */
  const tip = $("#tip");
  const tipAttr = (html) => `data-tip="${esc(html)}" tabindex="0"`;
  function placeTip(x, y) {
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = x + pad;
    let top = y + pad;
    if (left + w > innerWidth - 8) left = Math.max(8, x - w - pad);
    if (top + h > innerHeight - 8) top = Math.max(8, y - h - pad);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function showTip(el, x, y) {
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    if (x == null) {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.bottom;
    }
    placeTip(x, y);
  }
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el, e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => {
    if (!tip.hidden && e.target.closest("[data-tip]")) placeTip(e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest("[data-tip]") && !e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true;
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el);
  });
  document.addEventListener("focusout", () => (tip.hidden = true));
  addEventListener("scroll", () => (tip.hidden = true), { passive: true });

  /* ---------- small SVG helpers ---------- */
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  const widthOf = (el) => Math.max(280, el.clientWidth);

  /* One card per run, each metric beside its difference from `ref`. A metric is
     { k, v(run), f(value), better: 1 | -1 | 0 } with optional key, frac
     (a fraction, shown to two places) and ratio (shown as a multiple of ref). */
  function scoreCards(runs, ref, metrics) {
    return runs
      .map((r) => {
        const rows = metrics
          .map((m) => {
            const v = m.v(r);
            let d = "";
            let worse = false;
            if (r !== ref) {
              const rv = m.v(ref);
              if (m.ratio) {
                d = `×${(v / rv).toFixed(1)}`;
                worse = v > rv;
              } else {
                const diff = v - rv;
                const near = Math.abs(diff) < (m.frac ? 0.005 : 0.5);
                d = near ? "=" : `${diff > 0 ? "+" : "−"}${m.frac ? f2(Math.abs(diff)) : Math.abs(diff)}`;
                worse = !near && m.better !== 0 && Math.sign(diff) === -m.better;
              }
            }
            return `<div class="r${m.key ? " key" : ""}"><span class="k">${m.k}</span><span class="v">${m.f(v)}</span><span class="d${worse ? " worse" : ""}">${d}</span></div>`;
          })
          .join("");
        return `<article class="score" style="--c:${mColor(r)}"><h3>${esc(r.name)}${r === ref ? '<span class="ref">reference</span>' : ""}</h3><div class="rows">${rows}</div></article>`;
      })
      .join("");
  }

  /* One lane per run with a dot per row, ticks at the run's latency.p50 and
     latency.p95, and the speed check as a dashed line. `time(row)` is a row's
     milliseconds, `tip(run, row, i)` its tooltip, `per` what was timed. */
  function laneChart(el, runs, { time, tip, per, checkMs }) {
    const W = widthOf(el);
    const narrow = W < 560;
    const rowH = 84;
    const m = { l: narrow ? 70 : 130, r: 16, t: 26, b: 36 };
    const H = m.t + rowH * runs.length + m.b;
    const maxMs = Math.ceil(Math.max(...runs.map((r) => r.latency.max), checkMs) / 100) * 100;
    const x = lin(0, maxMs, m.l, W - m.r);
    let g = "";
    for (let t = 0; t <= maxMs; t += 100) {
      g += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text class="tick-text" x="${x(t)}" y="${H - m.b + 16}" text-anchor="middle">${t}</text>`;
    }
    g += `<text x="${W - m.r}" y="${H - 4}" text-anchor="end">ms per ${per} →</text>`;
    g += `<line class="check-line" x1="${x(checkMs)}" x2="${x(checkMs)}" y1="${m.t - 10}" y2="${H - m.b}"/><text class="ann" x="${x(checkMs) - 6}" y="${m.t - 12}" text-anchor="end">check 2: p95 ≤ ${checkMs} ms</text>`;
    let body = "";
    runs.forEach((run, k) => {
      const cy = m.t + rowH * k + rowH / 2;
      body += `<text class="ann-strong" x="${m.l - 12}" y="${cy + 4}" text-anchor="end">${esc(narrow ? run.short : run.name)}</text>`;
      body += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${cy + rowH / 2}" y2="${cy + rowH / 2}" style="stroke:var(--rule)"/>`;
      run.rows.forEach((row, i) => {
        const jitter = ((i * 7) % 5) - 2;
        body += `<circle class="dot" cx="${x(time(row))}" cy="${cy + jitter * 4}" r="4.5" style="fill:${mColor(run)};fill-opacity:.8" ${tipAttr(tip(run, row, i))}/>`;
      });
      // p50 labelled above its tick, p95 below, so close ticks don't collide.
      for (const [k2, v, ty] of [
        ["p50", run.latency.p50, cy - 24],
        ["p95", run.latency.p95, cy + 32],
      ]) {
        body += `<line x1="${x(v)}" x2="${x(v)}" y1="${cy - 20}" y2="${cy + 20}" style="stroke:var(--ink);pointer-events:none" stroke-width="2"/><text class="ann" x="${x(v)}" y="${ty}" text-anchor="middle" style="font-size:10px">${k2}</text>`;
      }
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Time per ${per} for each model">${g}${body}</svg>`;
  }

  function tocAndProgress() {
    const links = [...document.querySelectorAll("#toc a")];
    const secs = links.map((a) => document.querySelector(a.getAttribute("href")));
    const bar = $("#progress");
    const onScroll = () => {
      const h = document.documentElement;
      bar.style.width = `${(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) * 100}%`;
      let active = -1;
      secs.forEach((s, i) => {
        if (s.getBoundingClientRect().top < innerHeight * 0.35) active = i;
      });
      links.forEach((a, i) => a.classList.toggle("active", i === active));
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* Charts are sized to their container, so they are redrawn when the width changes. */
  function redrawOnResize(draw) {
    let timer;
    let lastW = innerWidth;
    addEventListener("resize", () => {
      if (innerWidth === lastW) return;
      lastW = innerWidth;
      clearTimeout(timer);
      timer = setTimeout(draw, 150);
    });
  }

  return { $, esc, f2, mColor, swatch, tipAttr, lin, widthOf, scoreCards, laneChart, tocAndProgress, redrawOnResize };
})();
