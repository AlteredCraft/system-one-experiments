/* The hypothesis test: against hand-labelled sub-agent tasks, how often does
   the router pick the labelled route, how often does it go too low or too
   high, and how much of the work leaves the most capable route? Needs
   TYPESAFE_API_KEY, or JEV_BACKEND=openjev and a running Open Jev server.

     node eval/run.mjs [router.config.json] [tasks.jsonl]

   Each task is asked once and the answers are replayed through the policy
   at several risk bars, so the table shows what moving the bar buys. Rules
   and pinned models are skipped: this measures the model's judgment only.
   Pin the decision model before comparing runs. */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, riskBar } from "../src/config.mjs";
import { deciderFromEnv } from "../src/decider.mjs";
import { decisionFrom } from "../src/policy.mjs";
import { buildQuestions, buildState, QUESTION } from "../src/questions.mjs";
import { percentile, summarise } from "./summary.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const [configPath = here("../examples/router.config.json"), tasksPath = here("./tasks.jsonl")] = process.argv.slice(2);
const BARS = [0.05, 0.1, 0.15, 0.25, 0.35, 0.5];

const config = await loadConfig(configPath);
const tasks = (await readFile(tasksPath, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));

let decider;
try {
  decider = deciderFromEnv(process.env, config.decider);
} catch (e) {
  console.error(`${e.message}. This script calls a live decision model; unit tests don't need one.`);
  process.exit(2);
}

const questions = buildQuestions(config);
// Untimed, so a TLS handshake or a cold model stays out of the latencies.
await decider.decide(buildState(tasks[0]), questions);

const rows = [];
for (const task of tasks) {
  const started = performance.now();
  const { model, answers } = await decider.decide(buildState(task), questions);
  rows.push({ ...task, answer: answers[QUESTION], model, latencyMs: performance.now() - started });
}

const ms = rows.map((r) => r.latencyMs);
const at = (p) => percentile(ms, p).toFixed(0);
console.log(`${decider.label} ${rows[0].model}  n=${rows.length}  latency p50 ${at(50)} ms  p95 ${at(95)} ms  max ${at(100)} ms\n`);

const ids = config.routes.map((r) => r.id);
console.log(`bar    agree  under  over   ${ids.join("  ")}`);
const summaries = BARS.map((bar) => summarise(config, rows, bar));
for (const s of summaries) {
  const share = ids.map((id) => pct(s.routes[id] / s.n).padStart(id.length));
  console.log(`${s.bar.toFixed(2)}   ${pct(s.agree / s.n)}   ${pct(s.under / s.n)}   ${pct(s.over / s.n)}   ${share.join("  ")}`);
}

console.log(`\nmisses at the configured bar (${riskBar(config)}):`);
for (const r of rows) {
  const d = decisionFrom(config, r.answer);
  if (d.route === r.label) continue;
  const p = ids.map((id) => d.probabilities[id].toFixed(2)).join("/");
  console.log(`  [${r.label} -> ${d.route}  ${p}] ${r.task}`);
}

const out = here(`./results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(out, JSON.stringify({ backend: decider.label, config, summaries, rows }, null, 2));
console.log(`\nwrote ${out}`);

function pct(x) {
  return `${(x * 100).toFixed(0).padStart(3)}%`;
}
