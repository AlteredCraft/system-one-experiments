/* model-router results page. Draws window.MR_DATA (data.js), which
   docs/tools/build-model-router-data.mjs generates from the recorded runs
   with model-router's own policy code. Nothing here re-decides a route:
   routes at any bar come from rows[].routeAt. Tooltips and chart helpers
   are in ../assets/results.js. */

(function () {
  "use strict";

  const D = window.MR_DATA;
  const runs = D.runs;
  const routes = D.routes;
  const ids = routes.map((r) => r.id);
  const N = D.tasks.length;
  const TOP = routes.length - 1;
  const DEFAULT_IDX = Math.round(D.defaultBar * 100);
  const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
  const ref = runs[0]; // TypeSafe Jev: the reference for deltas
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const { $, esc, f2, mColor, swatch, tipAttr, lin, widthOf, scoreCards, laneChart, tocAndProgress, redrawOnResize } = window.S1X;
  const ms = (x) => `${Math.round(x)} ms`;
  const rColor = (l) => `var(--r-${l})`;
  const rInk = (l) => `var(--r-ink-${l})`;
  const pct = (n) => `${Math.round((n / N) * 100)}%`;
  const summaryAt = (run, bar) => run.summaries.find((s) => Math.abs(s.bar - bar) < 1e-9);
  const atDefault = (run) => summaryAt(run, D.defaultBar);

  function outcome(route, label) {
    if (route === label) return "agree";
    return route < label ? "low" : "high";
  }
  const GLYPH = { agree: "✓", high: "▲", low: "▼" };
  const OUT_WORD = { agree: "as labelled", high: "too high", low: "too low" };

  function taskTip(n, run) {
    const row = run.rows[n - 1];
    const o = outcome(row.route, row.label);
    return (
      `<b>Task ${n}</b> · ${esc(run.name)}<br>${esc(D.tasks[n - 1])}` +
      `<span class="tm">${ids.map((id, l) => `${id} ${f2(row.p[l])}`).join(" · ")}</span>` +
      `<span class="tm">label ${ids[row.label]} · likeliest ${ids[row.likeliest]} · at ${D.defaultBar}: ${ids[row.route]} (${OUT_WORD[o]})${row.escalated ? ", moved up by the rule" : ""}</span>`
    );
  }

  /* ---------- hero ---------- */
  function hero() {
    const under = runs.reduce((a, r) => a + atDefault(r).under, 0);
    const misses = runs.reduce((a, r) => a + atDefault(r).under + atDefault(r).over, 0);
    const offTop = runs.map((r) => N - atDefault(r).routes[ids[TOP]]);
    const sameOff = offTop.every((v) => v === offTop[0]);
    $("#hero-stats").innerHTML = `
      <div class="stat"><div class="v">${N}<small> tasks</small></div><div class="k">hand-written sub-agent tasks, each asked once of ${runs.length} decision models</div></div>
      <div class="stat"><div class="v">${under}</div><div class="k">tasks sent to a model too weak for them, by any of the three</div></div>
      <div class="stat"><div class="v">${sameOff ? pct(offTop[0]) : offTop.map(pct).join(" / ")}</div><div class="k">of tasks kept off the most capable model${sameOff ? ", by all three" : ""}. ${misses} miss in ${N * runs.length} decisions.</div></div>
      <div class="stat"><div class="v lat">${runs
        .map((r) => `<span>${swatch(r)}${Math.round(r.latency.p50)}</span>`)
        .join("")}<small>ms</small></div><div class="k">median time per decision in this run: TypeSafe hosted, then Flash 9B and 27B on one laptop. <a href="#speed">Not the models' speed</a>.</div></div>`;
    $("#legend-models").innerHTML = runs
      .map((r) => `<span>${swatch(r)}<b>${esc(r.name)}</b>&nbsp;· ${r.where === "Local" ? `local, ${esc(r.size)}` : "hosted"}</span>`)
      .join("");
  }

  /* ---------- checks ---------- */
  function checks() {
    const s = runs.map(atDefault);
    const speedPass = runs.map((r) => r.latency.p95 <= D.speedCheckMs);
    const speedStatus = runs
      .filter((r, i) => !speedPass[i])
      .map((r) => `${r.short} misses by ${Math.round(r.latency.p95 - D.speedCheckMs)} ms`);
    const rowsHtml = [
      [
        "1 · Routing",
        "On ≥ 100 real tasks, a bar where ≤ 5% go too low and ≥ 50% leave the top route",
        s.map((x) => `<span class="mark-na">${pct(x.under)} low · ${pct(N - x.routes[ids[TOP]])} off top</span>`),
        `<span class="stamp">Not yet evidence</span><br><small>24 starter tasks, one author</small>`,
      ],
      [
        "2 · Speed",
        `p95 ≤ ${D.speedCheckMs} ms per decision`,
        runs.map((r, i) => `<span class="${speedPass[i] ? "mark-pass" : "mark-fail"}">${ms(r.latency.p95)}</span>`),
        speedStatus.length ? `${runs.length - speedStatus.length} of ${runs.length} pass. ${speedStatus.join("; ")}.` : "All pass",
      ],
      [
        "3 · Nothing invented",
        "Every decision names a model from the config",
        runs.map(() => `<span class="mark-pass">by construction</span>`),
        `<span class="stamp live">Pass</span><br><small>unit tests, whatever the model returns</small>`,
      ],
      [
        "4 · Outcomes",
        "Tasks sent below the top route succeed as often as on it",
        runs.map(() => `<span class="mark-na">—</span>`),
        `Later: needs the harness`,
      ],
    ];
    $("#checks-table tbody").innerHTML = rowsHtml
      .map(([c, done, cells, status]) => `<tr><td>${c}</td><td>${done}</td>${cells.map((x) => `<td>${x}</td>`).join("")}<td>${status}</td></tr>`)
      .join("");
  }

  /* ---------- model cards ---------- */
  function modelCards() {
    $("#model-cards").innerHTML = runs
      .map(
        (r) => `
        <article class="model-card reveal" style="--c:${mColor(r)}">
          <span class="where">${esc(r.where)}</span>
          <h3>${esc(r.name)}</h3>
          <dl>
            <dt>Served model</dt><dd><code>${esc(r.servedModel)}</code></dd>
            <dt>Size</dt><dd>${esc(r.size)}</dd>
          </dl>
          <p>${esc(r.note)}</p>
        </article>`,
      )
      .join("");
  }

  /* ---------- the question ---------- */
  function levels() {
    $("#levels-list").innerHTML = routes
      .map(
        (r, l) => `
        <li>
          <span class="lv" style="background:${rColor(l)};color:${rInk(l)}">${l}</span>
          <span class="desc">${esc(r.suits)}</span>
          <span class="map"><span>route</span><b>${esc(r.id)}</b><span>runs</span><b>${esc(r.model)}</b></span>
        </li>`,
      )
      .join("");
  }

  /* ---------- stacked bar ---------- */
  function segments(p, { big = false, labels = false } = {}) {
    return p
      .map((v, l) => {
        if (v < 0.005) return "";
        const show = labels && v >= 0.1;
        return `<div class="seg" style="flex-grow:${Math.max(v, 0.004)};--c:${rColor(l)};--tc:${rInk(l)}">${show ? `<span>${big && v >= 0.22 ? ids[l] + " " : ""}${f2(v)}</span>` : ""}</div>`;
      })
      .join("");
  }
  const stack = (p) => `<div class="stackbar">${segments(p)}</div>`;

  /* ---------- §5 explorer ---------- */
  function explorer() {
    const PRESETS = [
      { m: "27b", t: 5, bar: 25, txt: "Task 5 · 27B: the worked example" },
      { m: "27b", t: 9, bar: 25, txt: "Task 9 · 27B: sure" },
      { m: "flash", t: 15, bar: 25, txt: "Task 15 · Flash 9B: unsure" },
      { m: "typesafe", t: 3, bar: 5, txt: "Task 3 · TypeSafe: skips a tier" },
      { m: "27b", t: 7, bar: 25, txt: "Task 7 · 27B: the one miss" },
    ];
    const selM = $("#ex-model");
    const selT = $("#ex-task");
    const range = $("#ex-bar");
    selM.innerHTML = runs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    selT.innerHTML = D.tasks
      .map((t, i) => `<option value="${i + 1}">${i + 1}. ${esc(t.length > 54 ? t.slice(0, 52) + "…" : t)}</option>`)
      .join("");
    $("#presets").innerHTML = PRESETS.map((p, i) => `<button class="btn" data-i="${i}" aria-pressed="false">${p.txt}</button>`).join("");

    const state = { m: "27b", t: 5, bar: 25 };
    function sync() {
      selM.value = state.m;
      selT.value = String(state.t);
      range.value = String(state.bar);
      document.querySelectorAll("#presets .btn").forEach((b) => {
        const p = PRESETS[+b.dataset.i];
        b.setAttribute("aria-pressed", String(p.m === state.m && p.t === state.t && p.bar === state.bar));
      });
      render();
    }
    function render() {
      const run = byId[state.m];
      const row = run.rows[state.t - 1];
      const bar = D.slider[state.bar];
      const chosen = row.routeAt[state.bar];
      $("#ex-bar-out").textContent = f2(bar);
      $("#ex-tasktext").innerHTML = `${state.t}. ${esc(D.tasks[state.t - 1])}<span class="lab">· labelled ${ids[row.label]}</span>`;
      $("#ex-stack").innerHTML = segments(row.p, { big: true, labels: true });
      const maxP = Math.max(...row.p);
      $("#ex-likeliest").innerHTML =
        `${ids.map((id, l) => `${id} <b>${f2(row.p[l])}</b>`).join(" · ")}<br>` +
        `Biggest number: <b>${ids[row.likeliest]}</b> at ${f2(maxP)}. ${run.name} ${maxP >= D.sureAt ? "was sure." : maxP < 0.7 ? "was unsure." : "leaned one way."}`;
      $("#ex-ladder").innerHTML = routes
        .map((r, l) => {
          const risk = row.risk[l];
          const pass = risk <= bar + 1e-9;
          const above = ids.slice(l + 1);
          const why = above.length ? `P(${above.join(" or ")})` : "nothing above it";
          return `
            <div class="rung${l === chosen ? " chosen" : ""}" ${tipAttr(`<b>Send to ${r.id}?</b><br>Risk it needed more = ${why} = ${f2(risk)}.<br>${pass ? "At or under" : "Over"} the bar of ${f2(bar)}.`)}>
              <span class="rid"><i style="--c:${rColor(l)}"></i>${r.id}</span>
              <span class="rtrack"><span class="rfill" style="width:${risk * 100}%"></span><span class="rbar" style="left:calc(${bar * 100}% - 1px)"></span></span>
              <span class="rres ${pass ? "pass" : "fail"}">${f2(risk)} ${pass ? "✓ pass" : "✗"}</span>
            </div>`;
        })
        .join("");
      const o = outcome(chosen, row.label);
      let note;
      if (chosen > row.likeliest) {
        const why = `The rule moved it up from ${ids[row.likeliest]}: there was a ${f2(row.risk[row.likeliest])} chance that ${ids[row.likeliest]} would be too weak, over the bar.`;
        note =
          outcome(row.likeliest, row.label) === "low"
            ? `${why} Taking the biggest number would have sent it too low.`
            : `${why} At a bar this strict it goes past its label; here the biggest number would have been right.`;
      } else if (chosen < row.likeliest) {
        note = `The bar is loose enough to settle for a cheaper route than the likeliest one.`;
      } else if (maxP >= D.sureAt) {
        note = `Jev was sure, so the bar makes little difference: the policy and the biggest number agree.`;
      } else {
        note = `The cheapest route that passes is also the likeliest.`;
      }
      $("#ex-verdict").innerHTML =
        `→ Sent to <b>${ids[chosen]}</b> (<code>${esc(routes[chosen].model)}</code>): <span class="o-${o}">${GLYPH[o]} ${OUT_WORD[o]}</span>` +
        `<span class="note">${note}</span>`;
    }
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b) return;
      const p = PRESETS[+b.dataset.i];
      Object.assign(state, { m: p.m, t: p.t, bar: p.bar });
      sync();
    });
    selM.addEventListener("change", () => ((state.m = selM.value), sync()));
    selT.addEventListener("change", () => ((state.t = +selT.value), sync()));
    range.addEventListener("input", () => ((state.bar = +range.value), sync()));
    sync();
  }

  /* ---------- §6 scoreboard ---------- */
  function scoreboard() {
    const metrics = [
      { k: "Routed as labelled", v: (r) => atDefault(r).agree, f: (v) => `${v} of ${N}`, better: 1, key: true },
      { k: "Routed too low", v: (r) => atDefault(r).under, f: String, better: -1, key: true },
      { k: "Routed too high", v: (r) => atDefault(r).over, f: String, better: -1 },
      { k: "Kept off the top model", v: (r) => N - atDefault(r).routes[ids[TOP]], f: (v) => `${v} (${pct(v)})`, better: 1 },
      { k: `Sure (≥ ${D.sureAt} on one route)`, v: (r) => r.sure, f: (v) => `${v} of ${N}`, better: 1 },
      { k: "Too low if it took the biggest number", v: (r) => r.likeliestWrongLow, f: String, better: -1 },
      { k: "Median per decision, this setup", v: (r) => r.latency.p50, f: ms, better: -1, ratio: true },
    ];
    $("#scoreboard").innerHTML = scoreCards(runs, ref, metrics);

    const s = runs.map(atDefault);
    const missRuns = runs.filter((r, i) => s[i].over + s[i].under > 0);
    const sureText = runs.map((r) => `${r.short} ${r.sure}`).join(", ");
    const flash = byId.flash;
    const fastest = [...runs].sort((a, b) => a.latency.p50 - b.latency.p50)[0];
    const local = runs.filter((r) => r.where === "Local").sort((a, b) => a.latency.p50 - b.latency.p50);
    $("#findings").innerHTML = [
      `<b>No model sent a task too low.</b> ${missRuns
        .map((r) => {
          const misses = r.rows.map((row, i) => [row, i + 1]).filter(([row]) => row.route !== row.label);
          return `The only miss, by the ${r.short}, was task ${misses.map(([, n]) => n).join(", ")}, one tier too high.`;
        })
        .join(" ")}`,
      `<b>They differ in certainty.</b> Tasks where a model put ≥ ${D.sureAt} on one route: ${sureText}, out of ${N}.`,
      `<b>Flash 9B's ${s[runs.indexOf(flash)].agree} of ${N} depends on the routing rule.</b> Its biggest number would have sent ${flash.likeliestWrongLow} tasks to too weak a model; the rule moved them up. For the other two the rule changed nothing.`,
      `<b>${fastest.name} was fastest</b>, network round trip included. Of the local models, ${local[0].short} answered ×${(local[1].latency.p50 / local[0].latency.p50).toFixed(1)} faster than the ${local[1].short}, at about a third of the download (${local[0].size} against ${local[1].size}). <a href="#latency-note">These timings describe this setup, not the models</a>.`,
    ]
      .map((t) => `<li>${t}</li>`)
      .join("");
  }

  /* ---------- §7a certainty curves ---------- */
  let sureKey = "top";
  function sureChart() {
    const el = $("#sure-chart");
    const W = widthOf(el);
    const narrow = W < 560;
    const H = narrow ? 300 : 340;
    const m = { l: 40, r: narrow ? 16 : 150, t: 30, b: 40 };
    const x = lin(1, N, m.l, W - m.r);
    const y0 = sureKey === "top" ? 0.3 : 0; // a likeliest route has at least 1/3 of 3 routes
    const y = lin(y0, 1, H - m.b, m.t);
    const val = (run, row) => (sureKey === "top" ? Math.max(...row.p) : row.p[row.label]);
    let g = "";
    for (const t of sureKey === "top" ? [0.3, 0.5, 0.7, 0.9, 1] : [0, 0.25, 0.5, 0.75, 1]) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(2)}</text>`;
    }
    const refLine = sureKey === "top" ? D.sureAt : 0.5;
    g += `<line class="check-line" style="stroke:var(--ink-2)" x1="${m.l}" x2="${W - m.r}" y1="${y(refLine)}" y2="${y(refLine)}"/>`;
    g += `<line class="check-line" style="stroke:var(--ink-2)" x1="${W - m.r - 24}" x2="${W - m.r}" y1="${m.t - 18}" y2="${m.t - 18}"/>`;
    g += `<text class="ann" x="${W - m.r - 30}" y="${m.t - 14}" text-anchor="end">${sureKey === "top" ? `sure: ≥ ${D.sureAt}` : "0.50: below it, the label wasn't the biggest number"}</text>`;
    g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">tasks, each model's sorted from most to least sure →</text>`;
    let dots = "";
    let lines = "";
    let labels = "";
    const ends = [];
    runs.forEach((run) => {
      const pts = run.rows.map((row, i) => ({ n: i + 1, v: val(run, row), run })).sort((a, b) => b.v - a.v || a.n - b.n);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      lines += `<path d="${d}" fill="none" style="stroke:${mColor(run)}" stroke-width="2" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => {
        dots += `<circle class="dot" cx="${x(i + 1)}" cy="${y(p.v)}" r="4.5" style="fill:${mColor(run)}" ${tipAttr(taskTip(p.n, run) + `<span class="tm">${sureKey === "top" ? "on its likeliest route" : "on the labelled route"}: ${f2(p.v)}</span>`)}/>`;
      });
      const count = sureKey === "top" ? pts.filter((p) => p.v >= D.sureAt).length : null;
      const mean = sureKey === "top" ? null : run.meanOnLabel;
      ends.push({ run, y: y(pts[pts.length - 1].v), text: sureKey === "top" ? `${run.short}: ${count} sure` : `${run.short}: mean ${f2(mean)}` });
    });
    if (!narrow) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
      ends.forEach((e) => {
        labels += `<circle cx="${W - m.r + 12}" cy="${e.y - 4}" r="4" style="fill:${mColor(e.run)}"/><text class="ann" x="${W - m.r + 22}" y="${e.y}">${esc(e.text)}</text>`;
      });
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Certainty curves for the three decision models">${g}${lines}${dots}${labels}</svg>${
      narrow ? `<div class="legend-models" style="margin-top:8px">${ends.map((e) => `<span>${swatch(e.run)}${esc(e.text)}</span>`).join("")}</div>` : ""
    }`;
    $("#sure-cap").innerHTML =
      sureKey === "top"
        ? `<b>Fig. 3</b>The probability each model put on its likeliest route, for each task, sorted. TypeSafe Jev and the 27B sit at the top for most tasks and drop off at the end; Flash 9B declines from the start. Hover or tap a dot for the task and the full answer.`
        : `<b>Fig. 3</b>The probability each model put on the route the task was labelled with, sorted. Below 0.50 the label wasn't the biggest number, but the rule can still route the task correctly, as it did for Flash 9B's tasks 14–16. Hover or tap a dot for the task.`;
  }

  /* ---------- §7b task grid ---------- */
  const differSet = new Set();
  const unsureSet = new Set();
  for (let i = 0; i < N; i++) {
    const rs = new Set(runs.map((r) => r.rows[i].route));
    const ls = new Set(runs.map((r) => r.rows[i].likeliest));
    if (rs.size > 1 || ls.size > 1) differSet.add(i + 1);
    if (runs.some((r) => Math.max(...r.rows[i].p) < 0.7)) unsureSet.add(i + 1);
  }
  let gridFilter = "differ";
  function taskGrid() {
    const keep = (n) => gridFilter === "all" || (gridFilter === "differ" ? differSet.has(n) : unsureSet.has(n));
    const head = `<div class="tg-head"><span>#</span><span>Task</span><span>Label</span>${runs
      .map((r) => `<span>${swatch(r)}${esc(r.short)}</span>`)
      .join("")}</div>`;
    const rows = D.tasks
      .map((t, i) => {
        const n = i + 1;
        if (!keep(n)) return "";
        const label = runs[0].rows[i].label;
        const cells = runs
          .map((r) => {
            const row = r.rows[i];
            const o = outcome(row.route, row.label);
            return `<div class="tg-cell" ${tipAttr(taskTip(n, r))}><span class="tg-mlabel">${esc(r.short)}</span>${stack(row.p)}<span class="o"><span class="o-${o}">${GLYPH[o]}</span>${row.escalated ? '<span class="o-up">↑</span>' : ""}</span></div>`;
          })
          .join("");
        return `<div class="tg-row enter${differSet.has(n) ? " differs" : ""}"><span class="n">${n}</span><span class="t">${esc(t)}</span><span class="lab"><i style="--c:${rColor(label)}"></i>${ids[label]}</span>${cells}</div>`;
      })
      .join("");
    $("#taskgrid").innerHTML = head + rows;
  }

  function deltaNotes() {
    const mini = (n, list) =>
      list
        .map(
          (r) =>
            `<div class="mr" ${tipAttr(taskTip(n, r))}><span>${swatch(r)}${esc(r.short)}</span>${stack(r.rows[n - 1].p)}<span>${f2(Math.max(...r.rows[n - 1].p))}</span></div>`,
        )
        .join("");
    const miss = byId["27b"].rows[6];
    const flash = byId.flash;
    const ts16 = byId.typesafe.rows[15];
    $("#delta-notes").innerHTML = `
      <article class="delta-note">
        <span class="label">Task 7 · the only miss</span>
        <h4>"Rename MAX_RETRY … defined and used twice"</h4>
        <p>Labelled ${ids[miss.label]}. The 27B sent it to ${ids[miss.route]} (${miss.p.map(f2).join(" / ")}). The lookup description says "one small change whose exact content is given", and a rename across a definition and two uses is three edits, which may be why. TypeSafe Jev put ${f2(byId.typesafe.rows[6].p[0])} on lookup and Flash 9B ${f2(flash.rows[6].p[0])}.</p>
        <div class="mini">${mini(7, runs)}</div>
      </article>
      <article class="delta-note">
        <span class="label">Tasks 14, 15, 16 · Flash 9B split, the rule caught it</span>
        <h4>Small, well-specified changes labelled standard</h4>
        <p>Flash 9B split all three between lookup and standard, with lookup slightly ahead (${[13, 14, 15].map((i) => f2(flash.rows[i].p[0])).join(", ")}). The rule moved each up to standard. The 27B was sure of all three; TypeSafe Jev was sure of 14 and 15 and less sure of 16, the README task (${f2(ts16.p[1])} on standard).</p>
        <div class="mini">${[14, 15, 16].map((n) => `<div class="label" style="margin-top:4px">Task ${n}</div>${mini(n, runs)}`).join("")}</div>
      </article>`;
  }

  /* ---------- §8 move the bar ---------- */
  let barIdx = DEFAULT_IDX;
  const countsAt = (run, idx) => {
    const c = { agree: 0, low: 0, high: 0, offTop: 0 };
    for (const row of run.rows) {
      const route = row.routeAt[idx];
      c[outcome(route, row.label)] += 1;
      if (route !== TOP) c.offTop += 1;
    }
    return c;
  };
  function barPanels() {
    const OC = { low: "var(--critical)", high: "var(--warning)" };
    $("#bar-panels").innerHTML = runs
      .map((run) => {
        const lanes = routes
          .map((r, l) => {
            const cells = run.rows
              .map((row, i) => [row, i + 1])
              .filter(([row]) => row.label === l)
              .map(([row, n]) => {
                const route = row.routeAt[barIdx];
                const o = outcome(route, row.label);
                return `<span class="cell ${o}" style="--c:${rColor(route)};--tc:${rInk(route)};--oc:${OC[o] || "transparent"}" ${tipAttr(
                  `<b>Task ${n}</b> · ${esc(run.name)}<br>${esc(D.tasks[n - 1])}<span class="tm">label ${ids[row.label]} → at ${f2(D.slider[barIdx])}: ${ids[route]} (${OUT_WORD[o]})</span>`,
                )}>${o === "agree" ? "" : GLYPH[o]}</span>`;
              })
              .join("");
            return `<div class="lane"><span class="ln">${r.id}</span><span class="cells">${cells}</span></div>`;
          })
          .join("");
        const c = countsAt(run, barIdx);
        return `<div class="bp" style="--c:${mColor(run)}"><h4>${esc(run.name)}</h4>${lanes}
          <div class="counts">
            <div><b>${c.agree}</b><span>as labelled</span></div>
            <div class="${c.low ? "bad" : ""}"><b>${c.low}</b><span>too low ▼</span></div>
            <div class="${c.high ? "warn" : ""}"><b>${c.high}</b><span>too high ▲</span></div>
            <div><b>${pct(c.offTop)}</b><span>off top</span></div>
          </div></div>`;
      })
      .join("");
    $("#bar-out").textContent = f2(D.slider[barIdx]);
    $("#bar-range").value = String(barIdx);
    drawCountChart($("#low-chart"), "low");
    drawCountChart($("#high-chart"), "high");
  }
  function drawCountChart(el, key) {
    const W = widthOf(el);
    const H = 210;
    const m = { l: 34, r: 12, t: 12, b: 34 };
    const series = runs.map((run) => D.slider.map((_, i) => countsAt(run, i)[key]));
    const maxV = Math.max(4, ...series.flat());
    const yMax = Math.ceil(maxV / 4) * 4;
    const x = lin(0, D.slider[D.slider.length - 1], m.l, W - m.r);
    const y = lin(0, yMax, H - m.b, m.t);
    let g = "";
    for (let t = 0; t <= yMax; t += yMax / 4) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick-text" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    for (const b of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      g += `<text class="tick-text" x="${x(b)}" y="${H - m.b + 16}" text-anchor="middle">${b.toFixed(1)}</text>`;
    }
    g += `<text x="${W - m.r}" y="${H - 4}" text-anchor="end">bar →</text>`;
    g += `<line class="default-line" x1="${x(D.defaultBar)}" x2="${x(D.defaultBar)}" y1="${m.t}" y2="${H - m.b}"/>`;
    // Step lines, offset by a pixel or two so overlapping series stay visible.
    const off = [-1.5, 0, 1.5];
    const paths = series
      .map((s, k) => {
        let d = `M${x(D.slider[0])},${y(s[0]) + off[k]}`;
        for (let i = 1; i < s.length; i++) d += `H${x(D.slider[i])}V${y(s[i]) + off[k]}`;
        return `<path d="${d}" fill="none" style="stroke:${mColor(runs[k])}" stroke-width="2"/>`;
      })
      .join("");
    const cx = x(D.slider[barIdx]);
    const markers = series.map((s, k) => `<circle cx="${cx}" cy="${y(s[barIdx]) + off[k]}" r="4.5" style="fill:${mColor(runs[k])};stroke:var(--surface);stroke-width:2"/>`).join("");
    const hits = D.slider
      .map((b, i) => {
        const x0 = i === 0 ? m.l : (x(D.slider[i - 1]) + x(b)) / 2;
        const x1 = i === D.slider.length - 1 ? W - m.r : (x(b) + x(D.slider[i + 1])) / 2;
        return `<rect class="hit" data-idx="${i}" x="${x0}" y="${m.t}" width="${x1 - x0}" height="${H - m.b - m.t}" ${tipAttr(
          `<b>Bar ${f2(b)}</b> · routed ${key === "low" ? "too low" : "too high"}<br>${runs.map((r, k) => `${esc(r.short)}: ${series[k][i]}`).join("<br>")}`,
        )}/>`;
      })
      .join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks routed ${key === "low" ? "too low" : "too high"} at each bar, per model">${g}${paths}<line class="cursor" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${H - m.b}"/>${markers}${hits}</svg>`;
  }
  function barNotes() {
    const notes = runs.map((run) => {
      const agree = D.slider.map((_, i) => countsAt(run, i).agree);
      const best = Math.max(...agree);
      const first = agree.indexOf(best);
      let last = first;
      while (last + 1 < agree.length && agree[last + 1] === best) last++;
      const firstLow = D.slider.findIndex((_, i) => countsAt(run, i).low > 0);
      const range = `${f2(D.slider[first])}${last > first ? `–${f2(D.slider[last])}` : ""}`;
      const where = last === D.slider.length - 1 ? `at every bar from ${f2(D.slider[first])} to the end of the slider` : `at bars ${range}`;
      return `<b>${esc(run.name)}</b>: ${best === N ? `all ${N}` : `at best ${best} of ${N}`} as labelled, ${where}. ${firstLow < 0 ? `No task goes too low anywhere up to ${f2(D.slider[D.slider.length - 1])}.` : `The first task goes too low at ${f2(D.slider[firstLow])}.`}`;
    });
    notes.push(
      `<b>A move isn't always one tier.</b> On task 3, TypeSafe Jev put nearly all its doubt on open_ended, not standard (${byId.typesafe.rows[2].p.map(f2).join(" / ")}), so at 0.05 the task jumps from the cheapest route straight to the most expensive.`,
    );
    $("#bar-notes").innerHTML = notes.map((t) => `<li>${t}</li>`).join("");
  }
  function barControls() {
    const range = $("#bar-range");
    const play = $("#bar-play");
    let timer = null;
    const stop = () => {
      clearInterval(timer);
      timer = null;
      play.textContent = "▶ Sweep";
      play.setAttribute("aria-pressed", "false");
    };
    range.addEventListener("input", () => {
      stop();
      barIdx = +range.value;
      barPanels();
    });
    $("#bar-reset").addEventListener("click", () => {
      stop();
      barIdx = DEFAULT_IDX;
      barPanels();
    });
    play.addEventListener("click", () => {
      if (timer) return stop();
      if (barIdx >= D.slider.length - 1) barIdx = 0;
      play.textContent = "❚❚ Pause";
      play.setAttribute("aria-pressed", "true");
      timer = setInterval(
        () => {
          barIdx += 1;
          barPanels();
          if (barIdx >= D.slider.length - 1) stop();
        },
        reduceMotion ? 250 : 110,
      );
    });
    for (const id of ["#low-chart", "#high-chart"]) {
      $(id).addEventListener("click", (e) => {
        const hit = e.target.closest(".hit");
        if (!hit) return;
        stop();
        barIdx = +hit.dataset.idx;
        barPanels();
      });
    }
  }

  /* ---------- §9 latency ---------- */
  function latChart() {
    laneChart($("#lat-chart"), runs, {
      time: (row) => row.latencyMs,
      tip: (run, row, i) => `<b>Task ${i + 1}</b> · ${esc(run.name)}<br>${ms(row.latencyMs)}<span class="tm">${esc(D.tasks[i])}</span>`,
      per: "decision",
      checkMs: D.speedCheckMs,
    });
  }
  function latTable() {
    $("#lat-table tbody").innerHTML = runs
      .map((r) => {
        const L = r.latency;
        const pass = L.p95 <= D.speedCheckMs;
        return `<tr><td>${swatch(r)}${esc(r.name)}</td>${[L.p50, L.p95, L.max].map((v) => `<td class="num">${ms(v)}</td>`).join("")}<td><span class="${pass ? "mark-pass" : "mark-fail"}">${pass ? "pass" : `misses by ${Math.round(L.p95 - D.speedCheckMs)} ms`}</span></td></tr>`;
      })
      .join("");
  }

  /* ---------- misc ---------- */
  function sources() {
    $("#sources").innerHTML = D.generatedFrom
      .map((p, i) => `<a href="https://github.com/AlteredCraft/system-one-experiments/blob/main/${p}">${esc(runs[i].short)}</a>`)
      .join(", ");
  }
  function routeKey() {
    $("#route-key").innerHTML = routes.map((r, l) => `<span><i style="--c:${rColor(l)}"></i>${r.id}</span>`).join("");
  }
  function toggles() {
    $("#sure-toggle").addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b) return;
      sureKey = b.dataset.k;
      document.querySelectorAll("#sure-toggle .btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      sureChart();
    });
    $("#grid-filter").addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b) return;
      gridFilter = b.dataset.f;
      document.querySelectorAll("#grid-filter .btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      taskGrid();
    });
  }

  /* Charts sized to their container; redrawn when the width changes. */
  function drawCharts() {
    sureChart();
    barPanels();
    latChart();
  }

  hero();
  checks();
  modelCards();
  levels();
  explorer();
  scoreboard();
  routeKey();
  taskGrid();
  deltaNotes();
  sources();
  latTable();
  barNotes();
  toggles();
  barControls();
  drawCharts();
  tocAndProgress();

  redrawOnResize(drawCharts);
})();
