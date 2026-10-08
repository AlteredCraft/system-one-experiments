/* Put several eval/run.mjs results side by side, one decision model each, as Markdown.

     node eval/compare.mjs eval/results-A.json eval/results-B.json [...]

   Each run is scored at its own config's bar. The runs must cover the same tasks. */

import { readFile } from "node:fs/promises";
import { riskBar } from "../src/config.mjs";
import { differences, modelName, percentile, summarise } from "./summary.mjs";

const paths = process.argv.slice(2);
if (paths.length < 2) {
  console.error("usage: node eval/compare.mjs results-A.json results-B.json [...]");
  process.exit(2);
}

const runs = [];
for (const path of paths) {
  const { backend, config, rows } = JSON.parse(await readFile(path, "utf8"));
  runs.push({ name: `${backend} ${modelName(rows[0].model)}`, config, rows });
}

const pct = (n, of) => `${Math.round((100 * n) / of)}% (${n})`;
const top = runs[0].config.routes.at(-1).id;

console.log("| Decision model | Bar | Agree with label | Routed too low | Routed too high | Off the top route | p50 | p95 |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const { name, config, rows } of runs) {
  const bar = riskBar(config);
  const s = summarise(config, rows, bar);
  const ms = rows.map((r) => r.latencyMs);
  const cells = [name, bar, pct(s.agree, s.n), pct(s.under, s.n), pct(s.over, s.n), pct(s.n - s.routes[top], s.n)];
  console.log(`| ${cells.join(" | ")} | ${percentile(ms, 50).toFixed(0)} ms | ${percentile(ms, 95).toFixed(0)} ms |`);
}

const differing = differences(runs);
console.log(`\n${differing.length} of ${runs[0].rows.length} tasks were routed or ranked differently:\n`);
if (differing.length) {
  console.log(`| Task | Label | ${runs.map((r) => r.name).join(" | ")} |`);
  console.log(`| --- | --- | ${runs.map(() => "---").join(" | ")} |`);
  for (const { task, label, decisions } of differing) {
    const cells = runs.map(({ name }) => {
      const { route, probabilities } = decisions[name];
      return `${route} (${Object.values(probabilities).map((p) => p.toFixed(2)).join(" / ")})`;
    });
    console.log(`| ${task} | ${label} | ${cells.join(" | ")} |`);
  }
}
