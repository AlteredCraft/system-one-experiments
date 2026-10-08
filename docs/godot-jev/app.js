/* godot-jev results page. Draws window.GJ_DATA (data.js), which
   docs/tools/build-godot-jev-data.gd generates by replaying the recorded run
   through the game's own parser. Nothing here re-decides a turn: the outcome
   at any pair of thresholds comes from rows[].actMax and rows[].clarifyMax,
   the highest slider settings at which the parser still acted or still asked.
   Tooltips and chart helpers are in ../assets/results.js. */

(function () {
  "use strict";

  const D = window.GJ_DATA;
  const runs = D.runs;
  const lines = D.lines;
  const L = lines.length;
  const R = D.rounds;
  const N = L * R;
  const ACT = D.defaultAct;
  const CLARIFY = D.defaultClarify;
  const LAST = D.slider.length - 1;
  const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
  const ref = runs[0]; // TypeSafe Jev: the reference for deltas
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const { $, esc, f2, mColor, swatch, tipAttr, lin, widthOf, scoreCards, laneChart, tocAndProgress, redrawOnResize } = window.S1X;
  const ms = (x) => `${Math.round(x).toLocaleString("en-US")} ms`;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const rowAt = (run, line, round) => run.rows[line * R + round];
  const rowsOf = (run, line) => run.rows.slice(line * R, line * R + R);
  const meant = (line) => lines[line].means || D.none;
  const textOf = (line, id) => (id === D.none ? "none of these" : (lines[line].options.find((o) => o.id === id)?.text ?? id));

  /* The parser's outcome for a recorded answer with the sliders at a (act) and c (clarify). */
  const KINDS = ["unknown", "clarify", "act"]; // also the order of the shade ramp, --r-0 to --r-2
  const kindAt = (row, a, c) => (a <= row.actMax ? "act" : c <= row.clarifyMax ? "clarify" : "unknown");
  const kColor = (kind) => `var(--r-${KINDS.indexOf(kind)})`;
  const kInk = (kind) => `var(--r-ink-${KINDS.indexOf(kind)})`;

  /* How the turn went for the player: ok, ask, dead (a dead end) or wrong. */
  function turnAt(row, a, c) {
    const kind = kindAt(row, a, c);
    if (row.lands[kind]) return kind === "clarify" ? "ask" : "ok";
    return kind === "unknown" ? "dead" : "wrong";
  }
  const GLYPH = { ok: "✓", ask: "?", dead: "▼", wrong: "✗" };
  const O_CLASS = { ok: "o-agree", ask: "o-high", dead: "o-low", wrong: "o-low" };
  function turnWord(row, a, c) {
    const kind = kindAt(row, a, c);
    const turn = turnAt(row, a, c);
    if (turn === "ok") return kind === "act" ? "acted on the move the line means" : "unknown, as it should be";
    if (turn === "ask") return "asked, offering the move the line means";
    if (turn === "dead") return "unknown: a dead end";
    return kind === "act" ? "acted on a move the line doesn't mean" : "asked without offering the move";
  }
  const countsAt = (run, a, c) => {
    const n = { ok: 0, ask: 0, dead: 0, wrong: 0 };
    for (const row of run.rows) n[turnAt(row, a, c)] += 1;
    return n;
  };
  const mark = (row, a, c) => {
    const t = turnAt(row, a, c);
    return `<span class="${O_CLASS[t]}">${GLYPH[t]}</span>`;
  };

  function lineTip(line, run) {
    const rows = rowsOf(run, line);
    const first = rows[0];
    return (
      `<b>Line ${line + 1}</b> · ${esc(run.name)}<br>"${esc(lines[line].say)}"` +
      `<span class="tm">means: ${esc(lines[line].meansText || "nothing the author wrote")}</span>` +
      `<span class="tm">${first.ranked.map(([id, p]) => `${esc(textOf(line, id))} ${f2(p)}`).join(" · ")}</span>` +
      `<span class="tm">rounds: ${rows.map((r) => `${kindAt(r, ACT, CLARIFY)} ${f2(r.confidence)}`).join(" · ")}</span>`
    );
  }

  /* ---------- hero ---------- */
  function hero() {
    const at = runs.map((r) => countsAt(r, ACT, CLARIFY));
    const wrong = at.reduce((a, c) => a + c.wrong + c.dead, 0);
    const allTopRight = runs.every((r) => r.rows.every((row) => row.top === meant(row.line)));
    const asks = at.reduce((a, c) => a + c.ask, 0);
    const askers = runs.filter((r, i) => at[i].ask > 0);
    const askLines = new Set(askers.flatMap((r) => r.rows.filter((row) => turnAt(row, ACT, CLARIFY) === "ask").map((row) => row.line)));
    $("#hero-stats").innerHTML = `
      <div class="stat"><div class="v">${L}<small> lines × ${R}</small></div><div class="k">lines of slang that take the dungeon from the stairs to the crown, each asked ${R} times of ${runs.length} decision models</div></div>
      <div class="stat"><div class="v">${wrong}</div><div class="k">wrong moves or dead ends in ${N * runs.length} turns.${allTopRight ? " Every model ranked the right option first, every time." : ""}</div></div>
      <div class="stat"><div class="v">${asks}</div><div class="k">turns where the game had to ask "did you mean?": all ${askers.map((r) => esc(r.short)).join(" and ")}, on ${askLines.size} of the ${L} lines</div></div>
      <div class="stat"><div class="v lat">${runs
        .map((r) => `<span>${swatch(r)}${r.latency.p50}</span>`)
        .join("")}<small>ms</small></div><div class="k">median time per turn in this run: TypeSafe hosted, then Flash 9B and 27B on one laptop. <a href="#speed">Not the models' speed</a>.</div></div>`;
    $("#legend-models").innerHTML = runs
      .map((r) => `<span>${swatch(r)}<b>${esc(r.name)}</b>&nbsp;· ${r.where === "Local" ? `local, ${esc(r.size)}` : "hosted"}</span>`)
      .join("");
  }

  /* ---------- checks ---------- */
  function checks() {
    const speedPass = runs.map((r) => r.latency.p95 <= D.speedCheckMs);
    const speedStatus = runs.filter((r, i) => !speedPass[i]).map((r) => `${r.short} misses by ${r.latency.p95 - D.speedCheckMs} ms`);
    const rowsHtml = [
      [
        "1 · Understanding",
        "On ≥ 100 player inputs, ≥ 90% land on the intended move or a clarify that offers it, and ≥ 90% of impossible ones come back unknown",
        runs.map((r) => `<span class="mark-na">${r.summary.landed} of ${N} landed</span>`),
        `<span class="stamp">Not yet evidence</span><br><small>${L} lines in one voice, one of them impossible</small>`,
      ],
      [
        "2 · Speed",
        `p95 ≤ ${D.speedCheckMs} ms per turn`,
        runs.map((r, i) => `<span class="${speedPass[i] ? "mark-pass" : "mark-fail"}">${ms(r.latency.p95)}</span>`),
        `${speedStatus.length ? `${runs.length - speedStatus.length} of ${runs.length} pass. ${speedStatus.join("; ")}.` : "All pass."}<br><small>on this setup: see <a href="#latency-note">the note under Speed</a></small>`,
      ],
      [
        "3 · Nothing invented",
        "The options offered are exactly the possible moves, plus none",
        runs.map(() => `<span class="mark-pass">by construction</span>`),
        `<span class="stamp live">Pass</span><br><small>a unit test over the demo's states</small>`,
      ],
      [
        "4 · Shippable",
        "An exported build works with no key in the client, through a small proxy",
        runs.map(() => `<span class="mark-na">—</span>`),
        `Not started: needs the proxy`,
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
            <dt>Rounds</dt><dd>${r.sameEveryRound ? "the same answer to a line every round" : "confidence moved a little between rounds"}</dd>
          </dl>
          <p>${esc(r.note)}</p>
        </article>`,
      )
      .join("");
  }

  /* ---------- §4 the question ---------- */
  function question() {
    const steps = $("#q-steps");
    steps.innerHTML = lines.map((_, i) => `<button class="btn" data-i="${i}" aria-pressed="false" aria-label="Line ${i + 1}">${i + 1}</button>`).join("");
    let at = 8;
    function render() {
      const line = lines[at];
      steps.querySelectorAll(".btn").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === at)));
      $("#q-say").innerHTML = `${at + 1}. ${esc(line.say)}<span class="lab">· in the ${esc(line.room)}</span>`;
      // Godot writes the request with its keys sorted, so this is the order on the wire.
      const state = { ...line.state, player_typed: line.say };
      const sorted = Object.fromEntries(Object.keys(state).sort().map((k) => [k, state[k]]));
      $("#q-state").textContent = JSON.stringify(sorted, null, 2);
      $("#q-text").textContent = D.question;
      $("#q-options").innerHTML =
        line.options
          .map(
            (o) =>
              `<li class="${o.id === line.means ? "meant" : ""}"><code>${esc(o.id)}</code><span>${esc(o.text)}</span>${o.id === line.means ? '<span class="tag">what this line means</span>' : ""}</li>`,
          )
          .join("") +
        `<li class="none${line.means ? "" : " meant"}"><code>${esc(D.none)}</code><span>${esc(D.noneText)}</span>${line.means ? "" : '<span class="tag">what this line means: nothing the author wrote</span>'}</li>`;
    }
    steps.addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b) return;
      at = +b.dataset.i;
      render();
    });
    render();
    const offered = lines.map((l) => l.options.length + 1);
    $("#q-cap").innerHTML =
      `<b>Fig. 3</b>The request for each of the ${L} lines, as the game built it. The list runs from ${Math.min(...offered)} to ${Math.max(...offered)} options along the route, ` +
      `counting "none of these". The model's answer can only be one of them.`;
  }

  /* ---------- an answer as a stacked bar: the top three, shaded by what they are ---------- */
  function role(line, id) {
    if (id === meant(line)) return 2;
    return id === D.none ? 0 : 1;
  }
  function segments(row, { big = false } = {}) {
    const rest = Math.max(0, 1 - row.ranked.reduce((a, [, p]) => a + p, 0));
    const segs = row.ranked
      .map(([id, p]) => {
        if (p < 0.005) return "";
        const l = role(row.line, id);
        const label = big && p >= 0.14 ? `<span>${p >= 0.3 ? esc(textOf(row.line, id)) + " " : ""}${f2(p)}</span>` : "";
        return `<div class="seg" style="flex-grow:${Math.max(p, 0.004)};--c:var(--r-${l});--tc:var(--r-ink-${l})">${label}</div>`;
      })
      .join("");
    return segs + (rest >= 0.005 ? `<div class="seg rest" style="flex-grow:${rest}"></div>` : "");
  }
  const stack = (row) => `<div class="stackbar">${segments(row)}</div>`;

  /* ---------- §5 explorer ---------- */
  function explorer() {
    const PRESETS = [
      { m: "flash", l: 5, act: ACT, clarify: CLARIFY, txt: "Line 6 · Flash 9B: asks" },
      { m: "flash", l: 6, act: ACT, clarify: CLARIFY, txt: "Line 7 · Flash 9B: 0.01 short" },
      { m: "27b", l: 8, act: ACT, clarify: CLARIFY, txt: "Line 9 · 27B: sure" },
      { m: "flash", l: 0, act: ACT, clarify: CLARIFY, txt: "Line 1 · Flash 9B: the gin line" },
      { m: "typesafe", l: 7, act: 90, clarify: CLARIFY, txt: "Line 8 · TypeSafe: a stricter game" },
    ];
    const selM = $("#ex-model");
    const selL = $("#ex-line");
    const selR = $("#ex-round");
    const actR = $("#ex-act");
    const clarR = $("#ex-clarify");
    selM.innerHTML = runs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    selL.innerHTML = lines.map((l, i) => `<option value="${i}">${i + 1}. ${esc(l.say.length > 46 ? l.say.slice(0, 44) + "…" : l.say)}</option>`).join("");
    selR.innerHTML = Array.from({ length: R }, (_, i) => `<option value="${i}">${i + 1} of ${R}</option>`).join("");
    $("#presets").innerHTML = PRESETS.map((p, i) => `<button class="btn" data-i="${i}" aria-pressed="false">${p.txt}</button>`).join("");

    const state = { m: "flash", l: 5, round: 0, act: ACT, clarify: CLARIFY };
    function sync() {
      selM.value = state.m;
      selL.value = String(state.l);
      selR.value = String(state.round);
      actR.value = String(state.act);
      clarR.value = String(state.clarify);
      document.querySelectorAll("#presets .btn").forEach((b) => {
        const p = PRESETS[+b.dataset.i];
        b.setAttribute("aria-pressed", String(p.m === state.m && p.l === state.l && p.act === state.act && p.clarify === state.clarify && state.round === 0));
      });
      render();
    }
    function render() {
      const run = byId[state.m];
      const row = rowAt(run, state.l, state.round);
      const line = lines[state.l];
      const act = D.slider[state.act];
      const clarify = D.slider[state.clarify];
      const kind = kindAt(row, state.act, state.clarify);
      const none = row.top === D.none;
      $("#ex-act-out").textContent = f2(act);
      $("#ex-clarify-out").textContent = f2(clarify);
      $("#ex-tasktext").innerHTML = `${state.l + 1}. ${esc(line.say)}<span class="lab">· means: ${esc(line.meansText || "nothing the author wrote")}</span>`;
      $("#ex-stack").innerHTML = segments(row, { big: true });
      $("#ex-top3").innerHTML = row.ranked
        .map(([id, p]) => `<li><i style="--c:var(--r-${role(state.l, id)})"></i><span>${esc(textOf(state.l, id))}</span><b>${f2(p)}</b></li>`)
        .join("");
      $("#ex-likeliest").innerHTML =
        `Chose <b>${esc(textOf(state.l, row.top))}</b> with a confidence of <b>${f2(row.confidence)}</b>. ` +
        `${esc(run.name)} ${row.confidence >= D.sureAt ? "was sure." : row.confidence < act ? "was not sure enough to act on it." : "leaned clearly one way."}`;

      const rungs = [
        {
          kind: "act",
          threshold: act,
          pass: state.act <= row.actMax,
          why: `Act if the confidence, ${f2(row.confidence)}, is at least ${f2(act)}.`,
        },
        {
          kind: "clarify",
          threshold: clarify,
          pass: state.clarify <= row.clarifyMax,
          why: `Otherwise ask if it is at least ${f2(clarify)}.`,
        },
      ];
      $("#ex-ladder").innerHTML =
        rungs
          .map((g) => {
            const res = none ? `chose "none" ✗` : `${f2(row.confidence)} ${g.pass ? "✓ pass" : "✗"}`;
            return `
            <div class="rung${g.kind === kind ? " chosen" : ""}" ${tipAttr(`<b>${g.kind === "act" ? "Act" : "Ask"}?</b><br>${g.why}${none ? '<br>The choice is "none of these", which is unknown at any confidence.' : ""}`)}>
              <span class="rid"><i style="--c:${kColor(g.kind)}"></i>${g.kind}</span>
              <span class="rtrack"><span class="rfill" style="width:${row.confidence * 100}%"></span><span class="rbar" style="left:calc(${g.threshold * 100}% - 1px)"></span></span>
              <span class="rres ${g.pass ? "pass" : "fail"}">${res}</span>
            </div>`;
          })
          .join("") +
        `<div class="rung${kind === "unknown" ? " chosen" : ""}" ${tipAttr(`<b>Unknown</b><br>What is left when neither threshold is met, or when the choice is "none of these".`)}>
          <span class="rid"><i style="--c:${kColor("unknown")}"></i>unknown</span>
          <span></span>
          <span class="rres ${kind === "unknown" ? "pass" : "fail"}">${kind === "unknown" ? "what's left" : "not needed"}</span>
        </div>`;

      const turn = turnAt(row, state.act, state.clarify);
      const verdictMark = `<span class="${O_CLASS[turn]}">${GLYPH[turn]} ${turnWord(row, state.act, state.clarify)}</span>`;
      let head;
      let note;
      if (kind === "act") {
        head = `→ Acts: <b>${esc(textOf(state.l, row.top))}</b>`;
        note = "The game applies the move and prints the response the author wrote for it.";
      } else if (kind === "clarify") {
        head = `→ Asks: <b>Did you mean: ${row.asks.map((id, i) => `${i + 1}. ${esc(textOf(state.l, id))}`).join("&nbsp; ")}</b>`;
        note =
          state.act - 1 <= row.actMax
            ? `The right move is option 1, and the confidence is ${f2(act - row.confidence)} under the act threshold: one step lower and the game acts.`
            : "The player answers with one keypress. Nothing in the game has changed yet.";
      } else if (none) {
        head = `→ Unknown: the game prints an authored line such as <b>"Nothing here answers to that."</b>`;
        note = `The model chose "none of these" at ${f2(row.ranked[0][1])}. That is unknown whatever the thresholds are.`;
      } else {
        head = `→ Unknown: the game prints an authored line such as <b>"Nothing here answers to that."</b>`;
        note = `The model's top choice was right, at ${f2(row.confidence)}, but the ask threshold is above it, so the player gets no question to answer.`;
      }
      $("#ex-verdict").innerHTML = `${head} ${verdictMark}<span class="note">${note}</span>`;
    }
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest(".btn");
      if (!b) return;
      const p = PRESETS[+b.dataset.i];
      Object.assign(state, { m: p.m, l: p.l, round: 0, act: p.act, clarify: p.clarify });
      sync();
    });
    selM.addEventListener("change", () => ((state.m = selM.value), sync()));
    selL.addEventListener("change", () => ((state.l = +selL.value), sync()));
    selR.addEventListener("change", () => ((state.round = +selR.value), sync()));
    actR.addEventListener("input", () => {
      state.act = +actR.value;
      state.clarify = Math.min(state.clarify, state.act);
      sync();
    });
    clarR.addEventListener("input", () => {
      state.clarify = +clarR.value;
      state.act = Math.max(state.act, state.clarify);
      sync();
    });
    sync();
  }

  /* ---------- §6 scoreboard ---------- */
  function scoreboard() {
    const at = (r) => countsAt(r, ACT, CLARIFY);
    const metrics = [
      { k: "Lines landed", v: (r) => r.summary.landed, f: (v) => `${v} of ${N}`, better: 1, key: true },
      { k: "Wrong moves and dead ends", v: (r) => at(r).wrong + at(r).dead, f: String, better: -1, key: true },
      { k: "Acted at once", v: (r) => r.summary.act, f: String, better: 1 },
      { k: 'Asked "did you mean?"', v: (r) => r.summary.clarify, f: String, better: -1 },
      { k: `Sure (confidence ≥ ${D.sureAt})`, v: (r) => r.sure, f: (v) => `${v} of ${N}`, better: 1 },
      { k: "Median per turn, this setup", v: (r) => r.latency.p50, f: ms, better: -1, ratio: true },
    ];
    $("#scoreboard").innerHTML = scoreCards(runs, ref, metrics);

    const moves = lines.filter((l) => l.means).length;
    const askers = runs.filter((r) => r.summary.clarify > 0);
    const askText = askers
      .map((r) => {
        const asked = [...new Set(r.rows.filter((row) => kindAt(row, ACT, CLARIFY) === "clarify").map((row) => row.line))];
        return `${r.name} asked on ${asked.length} of the ${moves} lines that mean a move (${asked
          .map((l) => `line ${l + 1} at ${f2(rowAt(r, l, 0).confidence)}`)
          .join(", ")}), in each of the ${R} rounds, and offered the right move first both times.`;
      })
      .join(" ");
    const local = runs.filter((r) => r.where === "Local").sort((a, b) => a.latency.p50 - b.latency.p50);
    $("#findings").innerHTML = [
      `<b>No wrong move in ${N * runs.length} turns.</b> Every model ranked the move the line means first on every turn, and chose "none of these" for the gin line every time.`,
      `<b>They differ in certainty.</b> Turns with a confidence of ${D.sureAt} or more: ${runs.map((r) => `${r.short} ${r.sure}`).join(", ")}, out of ${N}.`,
      `<b>Less certainty shows up as questions.</b> ${askText} The other two acted on every one.`,
      `<b>On this setup the hosted model and ${local[0].short} took about the same time</b>, a median of ${ms(ref.latency.p50)} and ${ms(local[0].latency.p50)}, and the ${local[1].short} took about ${(local[1].latency.p50 / local[0].latency.p50).toFixed(1)} times as long as ${local[0].short}. <a href="#latency-note">These timings describe this setup, not the models</a>.`,
    ]
      .map((t) => `<li>${t}</li>`)
      .join("");
  }

  /* ---------- §7a confidence along the route ---------- */
  let sureKey = "route";
  function sureChart() {
    const el = $("#sure-chart");
    const W = widthOf(el);
    const narrow = W < 560;
    const H = narrow ? 300 : 340;
    const m = { l: 40, r: narrow ? 16 : 150, t: 30, b: 40 };
    const x = lin(1, L, m.l + 8, W - m.r - 8);
    const y = lin(0.3, 1, H - m.b, m.t);
    let g = "";
    for (const t of [0.3, 0.5, 0.7, 0.9, 1]) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(2)}</text>`;
    }
    for (const [v, word] of [
      [D.thresholds.act, "act"],
      [D.thresholds.clarify, "ask"],
    ]) {
      g += `<line class="check-line" style="stroke:var(--ink-2)" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text class="ann" x="${m.l + 6}" y="${y(v) - 6}">${word} at ≥ ${f2(v)}</text>`;
    }
    if (sureKey === "route") {
      for (let i = 1; i <= L; i++) g += `<text class="tick-text" x="${x(i)}" y="${H - m.b + 16}" text-anchor="middle">${i}</text>`;
      g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">line, in the order the route types them →</text>`;
    } else {
      g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">lines, each model's sorted from most to least sure →</text>`;
    }
    let dots = "";
    let paths = "";
    let labels = "";
    const ends = [];
    runs.forEach((run) => {
      let pts = lines.map((_, i) => ({ line: i, v: mean(rowsOf(run, i).map((r) => r.confidence)) }));
      if (sureKey === "sorted") pts = pts.sort((a, b) => b.v - a.v || a.line - b.line);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      paths += `<path d="${d}" fill="none" style="stroke:${mColor(run)}" stroke-width="2" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => {
        dots += `<circle class="dot" cx="${x(i + 1)}" cy="${y(p.v)}" r="4.5" style="fill:${mColor(run)}" ${tipAttr(lineTip(p.line, run))}/>`;
      });
      ends.push({ run, y: y(pts[pts.length - 1].v), text: `${run.short}: mean ${f2(run.meanConfidence)}` });
    });
    if (!narrow) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
      ends.forEach((e) => {
        labels += `<circle cx="${W - m.r + 12}" cy="${e.y - 4}" r="4" style="fill:${mColor(e.run)}"/><text class="ann" x="${W - m.r + 22}" y="${e.y}">${esc(e.text)}</text>`;
      });
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Confidence of each decision model on each of the 16 lines">${g}${paths}${dots}${labels}</svg>${
      narrow ? `<div class="legend-models" style="margin-top:8px">${ends.map((e) => `<span>${swatch(e.run)}${esc(e.text)}</span>`).join("")}</div>` : ""
    }`;
    const flash = byId.flash;
    $("#sure-cap").innerHTML =
      sureKey === "route"
        ? `<b>Fig. 5</b>The confidence each model reported for its choice on each line, averaged over the ${R} rounds. Line 1 is the gin line, where the choice is "none of these". Flash 9B dips under the act threshold on lines 6 and 7 (${f2(rowAt(flash, 5, 0).confidence)} and ${f2(rowAt(flash, 6, 0).confidence)}); the other two stay above it throughout. Hover or tap a dot for the line and the full answer.`
        : `<b>Fig. 5</b>The same confidences, each model's sorted. The 27B sits near 1.00 for almost every line, TypeSafe Jev drops to ${f2(ref.lowestOnAMove)} at its least sure, and Flash 9B declines from the start. Hover or tap a dot for the line.`;
  }

  /* ---------- §7b line grid ---------- */
  const differSet = new Set();
  const unsureSet = new Set();
  for (let i = 0; i < L; i++) {
    const kinds = new Set(runs.flatMap((r) => rowsOf(r, i).map((row) => kindAt(row, ACT, CLARIFY))));
    if (kinds.size > 1) differSet.add(i);
    if (runs.some((r) => rowsOf(r, i).some((row) => row.confidence < D.thresholds.act))) unsureSet.add(i);
  }
  let gridFilter = "all";
  function lineGrid() {
    const keep = (i) => gridFilter === "all" || (gridFilter === "differ" ? differSet.has(i) : unsureSet.has(i));
    const head = `<div class="tg-head"><span>#</span><span>The player types</span><span>Means</span>${runs
      .map((r) => `<span>${swatch(r)}${esc(r.short)}</span>`)
      .join("")}</div>`;
    const rows = lines
      .map((line, i) => {
        if (!keep(i)) return "";
        const cells = runs
          .map((r) => {
            const row = rowAt(r, i, 0);
            return `<div class="tg-cell" ${tipAttr(lineTip(i, r))}><span class="tg-mlabel">${esc(r.short)}</span>${stack(row)}<span class="o">${mark(row, ACT, CLARIFY)}</span></div>`;
          })
          .join("");
        return `<div class="tg-row enter${differSet.has(i) ? " differs" : ""}"><span class="n">${i + 1}</span><span class="t">${esc(line.say)}<small>${esc(line.room)} · ${line.options.length + 1} options</small></span><span class="means${line.means ? "" : " nothing"}">${esc(line.meansText || "nothing the author wrote")}</span>${cells}</div>`;
      })
      .join("");
    $("#taskgrid").innerHTML = head + rows;
  }

  function deltaNotes() {
    const mini = (i) =>
      runs
        .map((r) => `<div class="mr" ${tipAttr(lineTip(i, r))}><span>${swatch(r)}${esc(r.short)}</span>${stack(rowAt(r, i, 0))}<span>${f2(rowAt(r, i, 0).confidence)}</span></div>`)
        .join("");
    const c = (id, i) => f2(rowAt(byId[id], i, 0).confidence);
    const p = (id, i) => f2(rowAt(byId[id], i, 0).ranked[0][1]);
    const gin = rowAt(byId.flash, 0, 0);
    $("#delta-notes").innerHTML = `
      <article class="delta-note">
        <span class="label">Lines 6 and 7 · Flash 9B asked</span>
        <h4>"${esc(lines[5].say)}" and "${esc(lines[6].say)}"</h4>
        <p>Flash 9B ranked the right move first on both, with a confidence of ${c("flash", 5)} and ${c("flash", 6)}, under the act threshold of ${f2(D.thresholds.act)}. The game asked "Did you mean:" with the right move as option 1. TypeSafe Jev (${c("typesafe", 5)}, ${c("typesafe", 6)}) and the 27B (${c("27b", 5)}, ${c("27b", 6)}) acted. Line 7 was ${f2(D.thresholds.act - rowAt(byId.flash, 6, 0).confidence)} short: at an act threshold of ${f2(D.slider[rowAt(byId.flash, 6, 0).actMax])} it acts.</p>
        <div class="mini">${[5, 6].map((i) => `<div class="label" style="margin-top:4px">Line ${i + 1}</div>${mini(i)}`).join("")}</div>
      </article>
      <article class="delta-note">
        <span class="label">Line 1 · the request the author never wrote</span>
        <h4>"${esc(lines[0].say)}"</h4>
        <p>All three chose "none of these", so the game printed an authored refusal. TypeSafe Jev put ${p("typesafe", 0)} on it and the 27B ${p("27b", 0)}. Flash 9B put ${p("flash", 0)}, with ${f2(gin.ranked[1][1])} on "${esc(textOf(0, gin.ranked[1][0]))}" and ${f2(gin.ranked[2][1])} on "${esc(textOf(0, gin.ranked[2][0]))}". The parser treats a choice of "none" as unknown at any confidence, so the thresholds played no part. One line is too few to say how often Flash 9B would pick a move here.</p>
        <div class="mini">${mini(0)}</div>
      </article>`;
  }

  /* ---------- §8 move the thresholds ---------- */
  let actIdx = ACT;
  let clarifyIdx = CLARIFY;
  function barPanels() {
    const OC = { ask: "var(--warning)", dead: "var(--critical)", wrong: "var(--critical)" };
    const CELL = { ok: "", ask: "high", dead: "low", wrong: "low" };
    $("#bar-panels").innerHTML = runs
      .map((run) => {
        const lanes = Array.from({ length: R }, (_, round) => {
          const cells = lines
            .map((_, i) => {
              const row = rowAt(run, i, round);
              const kind = kindAt(row, actIdx, clarifyIdx);
              const turn = turnAt(row, actIdx, clarifyIdx);
              return `<span class="cell ${CELL[turn]}" style="--c:${kColor(kind)};--tc:${kInk(kind)};--oc:${OC[turn] || "transparent"}" ${tipAttr(
                `<b>Line ${i + 1}</b>, round ${round + 1} · ${esc(run.name)}<br>"${esc(lines[i].say)}"<span class="tm">confidence ${f2(row.confidence)} → ${kind}: ${turnWord(row, actIdx, clarifyIdx)}</span>`,
              )}>${turn === "ok" ? "" : GLYPH[turn]}</span>`;
            })
            .join("");
          return `<div class="lane"><span class="ln">round ${round + 1}</span><span class="cells">${cells}</span></div>`;
        }).join("");
        const c = countsAt(run, actIdx, clarifyIdx);
        return `<div class="bp" style="--c:${mColor(run)}"><h4>${esc(run.name)}</h4>${lanes}
          <div class="counts">
            <div><b>${c.ok + c.ask}</b><span>landed</span></div>
            <div class="${c.ask ? "warn" : ""}"><b>${c.ask}</b><span>asked ?</span></div>
            <div class="${c.dead ? "bad" : ""}"><b>${c.dead}</b><span>dead ends ▼</span></div>
            <div class="${c.wrong ? "bad" : ""}"><b>${c.wrong}</b><span>wrong ✗</span></div>
          </div></div>`;
      })
      .join("");
    $("#act-out").textContent = f2(D.slider[actIdx]);
    $("#clarify-out").textContent = f2(D.slider[clarifyIdx]);
    $("#act-range").value = String(actIdx);
    $("#clarify-range").value = String(clarifyIdx);
    // Each chart moves one threshold and carries the other along, as the sliders do.
    drawCountChart($("#ask-chart"), "ask", actIdx, (i) => [i, Math.min(clarifyIdx, i)]);
    drawCountChart($("#dead-chart"), "dead", clarifyIdx, (i) => [Math.max(actIdx, i), i]);
  }
  function drawCountChart(el, key, cursor, settingAt) {
    const W = widthOf(el);
    const H = 210;
    const m = { l: 34, r: 12, t: 12, b: 34 };
    const series = runs.map((run) => D.slider.map((_, i) => countsAt(run, ...settingAt(i))[key]));
    const yMax = Math.ceil(Math.max(4, ...series.flat()) / 4) * 4;
    const x = lin(0, 1, m.l, W - m.r);
    const y = lin(0, yMax, H - m.b, m.t);
    const word = key === "ask" ? "answered with a question" : "dead ends";
    let g = "";
    for (let t = 0; t <= yMax; t += yMax / 4) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick-text" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    for (const b of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      g += `<text class="tick-text" x="${x(b)}" y="${H - m.b + 16}" text-anchor="middle">${b.toFixed(1)}</text>`;
    }
    g += `<text x="${W - m.r}" y="${H - 4}" text-anchor="end">${key === "ask" ? "act" : "ask"} threshold →</text>`;
    const def = D.slider[key === "ask" ? ACT : CLARIFY];
    g += `<line class="default-line" x1="${x(def)}" x2="${x(def)}" y1="${m.t}" y2="${H - m.b}"/>`;
    // Step lines, offset by a pixel or two so overlapping series stay visible.
    const off = [-1.5, 0, 1.5];
    const paths = series
      .map((s, k) => {
        let d = `M${x(D.slider[0])},${y(s[0]) + off[k]}`;
        for (let i = 1; i < s.length; i++) d += `H${x(D.slider[i])}V${y(s[i]) + off[k]}`;
        return `<path d="${d}" fill="none" style="stroke:${mColor(runs[k])}" stroke-width="2"/>`;
      })
      .join("");
    const cx = x(D.slider[cursor]);
    const markers = series.map((s, k) => `<circle cx="${cx}" cy="${y(s[cursor]) + off[k]}" r="4.5" style="fill:${mColor(runs[k])};stroke:var(--surface);stroke-width:2"/>`).join("");
    const hits = D.slider
      .map((b, i) => {
        const x0 = i === 0 ? m.l : (x(D.slider[i - 1]) + x(b)) / 2;
        const x1 = i === LAST ? W - m.r : (x(b) + x(D.slider[i + 1])) / 2;
        return `<rect class="hit" data-idx="${i}" x="${x0}" y="${m.t}" width="${x1 - x0}" height="${H - m.b - m.t}" ${tipAttr(
          `<b>${key === "ask" ? "Act" : "Ask"} threshold ${f2(b)}</b> · ${word}<br>${runs.map((r, k) => `${esc(r.short)}: ${series[k][i]} of ${N}`).join("<br>")}`,
        )}/>`;
      })
      .join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Turns ${word} at each threshold, per model">${g}${paths}<line class="cursor" x1="${cx}" x2="${cx}" y1="${m.t}" y2="${H - m.b}"/>${markers}${hits}</svg>`;
  }
  function barNotes() {
    const moves = (run) => run.rows.filter((r) => r.top !== D.none);
    const notes = runs.map((run) => {
      const actsUpTo = Math.min(...moves(run).map((r) => r.actMax));
      const asksUpTo = Math.min(...moves(run).map((r) => r.clarifyMax));
      return `<b>${esc(run.name)}</b>: acts at once on all ${moves(run).length} turns that mean a move while the act threshold is ${f2(D.slider[actsUpTo])} or lower, and starts to ask above it. No dead end until the ask threshold passes ${f2(D.slider[asksUpTo])}.`;
    });
    const canGoWrong = runs.some((run) => run.rows.some((r) => (r.actMax >= 0 && !r.lands.act) || (r.clarifyMax >= 0 && !r.lands.clarify)));
    if (!canGoWrong) {
      notes.push(
        `<b>No setting produces a wrong move in this run</b>, because every model ranked the right option first. Here the thresholds only trade acting against asking, and asking against a dead end. They protect against a confident wrong choice, and these lines never produced one.`,
      );
    }
    notes.push(`<b>The gin line is unknown at every setting.</b> All three chose "none of these", and the parser doesn't weigh that choice against a threshold.`);
    $("#bar-notes").innerHTML = notes.map((t) => `<li>${t}</li>`).join("");
  }
  function barControls() {
    const actR = $("#act-range");
    const clarR = $("#clarify-range");
    const play = $("#bar-play");
    let timer = null;
    const stop = () => {
      clearInterval(timer);
      timer = null;
      play.textContent = "▶ Sweep the act threshold";
      play.setAttribute("aria-pressed", "false");
    };
    const setAct = (i) => {
      actIdx = i;
      clarifyIdx = Math.min(clarifyIdx, i);
    };
    const setClarify = (i) => {
      clarifyIdx = i;
      actIdx = Math.max(actIdx, i);
    };
    actR.addEventListener("input", () => {
      stop();
      setAct(+actR.value);
      barPanels();
    });
    clarR.addEventListener("input", () => {
      stop();
      setClarify(+clarR.value);
      barPanels();
    });
    $("#bar-reset").addEventListener("click", () => {
      stop();
      actIdx = ACT;
      clarifyIdx = CLARIFY;
      barPanels();
    });
    play.addEventListener("click", () => {
      if (timer) return stop();
      if (actIdx >= LAST) actIdx = clarifyIdx;
      play.textContent = "❚❚ Pause";
      play.setAttribute("aria-pressed", "true");
      timer = setInterval(
        () => {
          actIdx += 1;
          barPanels();
          if (actIdx >= LAST) stop();
        },
        reduceMotion ? 250 : 110,
      );
    });
    for (const [id, set] of [
      ["#ask-chart", setAct],
      ["#dead-chart", setClarify],
    ]) {
      $(id).addEventListener("click", (e) => {
        const hit = e.target.closest(".hit");
        if (!hit) return;
        stop();
        set(+hit.dataset.idx);
        barPanels();
      });
    }
  }

  /* ---------- §9 latency ---------- */
  function latChart() {
    laneChart($("#lat-chart"), runs, {
      time: (row) => row.ms,
      tip: (run, row) =>
        `<b>Line ${row.line + 1}</b>, round ${row.round + 1} · ${esc(run.name)}<br>${ms(row.ms)}<span class="tm">"${esc(lines[row.line].say)}" · ${row.offered} options</span>`,
      per: "turn",
      checkMs: D.speedCheckMs,
    });
    $("#lat-cap").innerHTML =
      `<b>Fig. 8</b>Each dot is one turn: ${N} per model. Ticks mark p50 and p95. The three models were asked each line one after another, so they shared whatever else the laptop was doing at that moment. ` +
      `Times are taken in the game loop, which ticks about every 7 ms in a headless run, so dots line up in steps of that size.`;
  }
  function routeChart() {
    const el = $("#route-chart");
    const W = widthOf(el);
    const narrow = W < 560;
    const H = 320;
    const m = { l: 44, r: narrow ? 12 : 120, t: 16, b: 54 };
    const maxMs = Math.ceil(Math.max(...runs.map((r) => r.latency.max)) / 100) * 100;
    const x = lin(1, L, m.l + 10, W - m.r - 10);
    const y = lin(0, maxMs, H - m.b, m.t);
    let g = "";
    for (let t = 0; t <= maxMs; t += 100) {
      g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="tick-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    lines.forEach((line, i) => {
      g += `<text class="tick-text" x="${x(i + 1)}" y="${H - m.b + 16}" text-anchor="middle">${i + 1}</text>`;
      g += `<text class="tick-text" x="${x(i + 1)}" y="${H - m.b + 30}" text-anchor="middle" style="fill:var(--ink-2)">${line.options.length + 1}</text>`;
    });
    g += `<text x="${m.l - 8}" y="${H - m.b + 16}" text-anchor="end">line</text><text x="${m.l - 8}" y="${H - m.b + 30}" text-anchor="end">options</text>`;
    g += `<text x="${m.l}" y="${m.t - 4}">ms per turn</text>`;
    let body = "";
    const ends = [];
    runs.forEach((run) => {
      const means = lines.map((_, i) => mean(rowsOf(run, i).map((r) => r.ms)));
      body += `<path d="${means.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("")}" fill="none" style="stroke:${mColor(run)}" stroke-width="2" stroke-linejoin="round"/>`;
      run.rows.forEach((row) => {
        body += `<circle class="dot" cx="${x(row.line + 1)}" cy="${y(row.ms)}" r="3.5" style="fill:${mColor(run)};fill-opacity:.8" ${tipAttr(
          `<b>Line ${row.line + 1}</b>, round ${row.round + 1} · ${esc(run.name)}<br>${ms(row.ms)}<span class="tm">${row.offered} options · in the ${esc(lines[row.line].room)}</span>`,
        )}/>`;
      });
      ends.push({ run, y: y(means[L - 1]) + 4 });
    });
    if (!narrow) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 16);
      ends.forEach((e) => (body += `<text class="ann" x="${W - m.r + 4}" y="${e.y}">${esc(e.run.short)}</text>`));
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Time per turn for each line of the route, per model">${g}${body}</svg>${
      narrow ? `<div class="legend-models" style="margin-top:8px">${runs.map((r) => `<span>${swatch(r)}${esc(r.short)}</span>`).join("")}</div>` : ""
    }`;
    const span = (run) => {
      const first = mean(rowsOf(run, 0).map((r) => r.ms));
      const last = mean(rowsOf(run, L - 1).map((r) => r.ms));
      return `from about ${Math.round(first)} ms on line 1 to about ${Math.round(last)} ms on line ${L}`;
    };
    $("#route-cap").innerHTML =
      `<b>Fig. 9</b>The same turns in route order, with the number of options each question offered. The local models take longer as the request grows, with more options and more items in the state: ` +
      `the 27B ${span(byId["27b"])}, Flash 9B ${span(byId.flash)}. The hosted model shows no such trend at this size.`;
  }
  function latTable() {
    const check = (p95) => {
      const pass = p95 <= D.speedCheckMs;
      return `<span class="${pass ? "mark-pass" : "mark-fail"}">${pass ? "pass" : `misses by ${p95 - D.speedCheckMs} ms`}</span>`;
    };
    const day = (when) => when.slice(0, 10);
    const now = runs.map((r) => {
      const T = r.latency;
      return `<tr><td>${swatch(r)}${esc(r.name)}</td><td>${day(D.when)}</td>${[T.p50, T.p95, T.max].map((v) => `<td class="num">${ms(v)}</td>`).join("")}<td>${check(T.p95)}</td></tr>`;
    });
    const before = runs
      .filter((r) => D.earlier[r.id])
      .map((r) => {
        const s = D.earlier[r.id];
        return `<tr><td>${swatch(r)}${esc(r.name)}</td><td>${day(D.earlier.when)}</td><td class="num">${ms(s.p50_ms)}</td><td class="num">${ms(s.p95_ms)}</td><td class="num">${ms(s.max_ms)}</td><td>${check(s.p95_ms)}</td></tr>`;
      });
    $("#lat-table tbody").innerHTML = [...now, ...before].join("");
    const e = D.earlier;
    $("#lat-table-cap").innerHTML =
      `<b>Table 2</b>This run, and the same ${L} lines and ${e.rounds} rounds on ${day(e.when)} with the same pinned TypeSafe model and the same 27B build. ` +
      `The hosted p95 went from ${ms(e.typesafe.p95_ms)} to ${ms(ref.latency.p95)}: that run had two slow round trips (the slowest ${ms(e.typesafe.max_ms)}), this one had none. ` +
      `The 27B's median went from ${ms(e["27b"].p50_ms)} to ${ms(byId["27b"].latency.p50)}. The model versions were the same on both days and the conditions were not, which is why these read as measurements of a setup.`;
  }

  /* ---------- misc ---------- */
  function sources() {
    $("#sources").innerHTML = `<a href="https://github.com/AlteredCraft/system-one-experiments/blob/main/${D.generatedFrom}">${esc(D.generatedFrom.split("/").pop())}</a>`;
  }
  function routeKey() {
    $("#route-key").innerHTML =
      `<span><i style="--c:var(--r-2)"></i>what the line means</span><span><i style="--c:var(--r-1)"></i>another move</span>` +
      `<span><i style="--c:var(--r-0)"></i>none of these</span><span><i style="--c:var(--surface-2);box-shadow:inset 0 0 0 1px var(--rule)"></i>the other options</span>`;
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
      lineGrid();
    });
  }

  /* Charts sized to their container; redrawn when the width changes. */
  function drawCharts() {
    sureChart();
    barPanels();
    latChart();
    routeChart();
  }

  hero();
  checks();
  modelCards();
  question();
  explorer();
  scoreboard();
  routeKey();
  lineGrid();
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
