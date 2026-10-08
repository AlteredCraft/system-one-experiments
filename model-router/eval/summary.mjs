/* Scoring for eval/run.mjs, kept apart from it so it can be tested without the API. */

import { decisionFrom } from "../src/policy.mjs";

/** How `rows` ({ label, answer }) route at one risk bar, against their labels. */
export function summarise(config, rows, bar) {
  const level = Object.fromEntries(config.routes.map((r, i) => [r.id, i]));
  const routes = Object.fromEntries(config.routes.map((r) => [r.id, 0]));
  const out = { bar, n: rows.length, agree: 0, under: 0, over: 0, routes };
  for (const row of rows) {
    if (!(row.label in level)) throw new Error(`label ${row.label} is not a route`);
    const { route } = decisionFrom({ ...config, maxUnderRouteRisk: bar }, row.answer);
    out.routes[route] += 1;
    if (level[route] === level[row.label]) out.agree += 1;
    else if (level[route] < level[row.label]) out.under += 1;
    else out.over += 1;
  }
  return out;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** The served model's name. Open Jev appends its calibration settings to it. */
export const modelName = (model) => String(model).split(" ")[0];

/** Tasks where the runs ({ name, config, rows }) don't all have the same route and likeliest route,
    with each run's decision by run name. */
export function differences(runs) {
  const out = [];
  for (const { task, label } of runs[0].rows) {
    const decisions = {};
    for (const run of runs) {
      const row = run.rows.find((r) => r.task === task);
      if (!row) throw new Error(`${run.name} has no answer for task: ${task}`);
      decisions[run.name] = decisionFrom(run.config, row.answer);
    }
    const same = (field) => new Set(Object.values(decisions).map((d) => d[field])).size === 1;
    if (!same("route") || !same("likeliest")) out.push({ task, label, decisions });
  }
  return out;
}
