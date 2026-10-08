import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { differences, modelName, percentile, summarise } from "../eval/summary.mjs";
import { score } from "../src/index.mjs";

const config = JSON.parse(readFileSync(new URL("../examples/router.config.json", import.meta.url), "utf8"));
const rows = [
  { label: "lookup", answer: score([0.9, 0.1, 0]) },
  { label: "lookup", answer: score([0.6, 0.3, 0.1]) },
  { label: "standard", answer: score([0.8, 0.15, 0.05]) },
  { label: "open_ended", answer: score([0, 0.1, 0.9]) },
];

test("each bar replays the same answers through the policy", () => {
  assert.deepEqual(summarise(config, rows, 0.25), {
    bar: 0.25,
    n: 4,
    agree: 2,
    under: 1,
    over: 1,
    routes: { lookup: 2, standard: 1, open_ended: 1 },
  });
  const strict = summarise(config, rows, 0.05);
  assert.equal(strict.under, 0);
  assert.equal(strict.agree, 2);
  assert.equal(strict.over, 2);
  assert.deepEqual(strict.routes, { lookup: 0, standard: 2, open_ended: 2 });
});

test("a label that isn't a route is an error in the task file", () => {
  assert.throws(() => summarise(config, [{ label: "huge", answer: score([1, 0, 0]) }], 0.25), /label huge is not a route/);
});

test("percentiles use the nearest rank", () => {
  const ms = [300, 100, 200, 400];
  assert.equal(percentile(ms, 50), 200);
  assert.equal(percentile(ms, 95), 400);
  assert.equal(percentile([], 50), null);
});

test("Open Jev's model string is shortened to the model's name", () => {
  assert.equal(modelName('openjev-MLX-4bit T=0.85 noul=1.829074,0.0 flags={"perms":1} shim=shim.py@81a22f1b1b89'), "openjev-MLX-4bit");
  assert.equal(modelName("jev-1.13.0"), "jev-1.13.0");
});

test("runs are compared task by task at their configured bar", () => {
  const tasks = [
    { task: "a", label: "lookup" },
    { task: "b", label: "standard" },
  ];
  const run = (name, answers) => ({ name, config, rows: tasks.map((t, i) => ({ ...t, answer: score(answers[i]) })) });
  const big = run("big", [[0.9, 0.1, 0], [0.1, 0.8, 0.1]]);
  const small = run("small", [[0.9, 0.1, 0], [0.6, 0.3, 0.1]]);

  assert.deepEqual(differences([big, big]), []);
  const [only, ...rest] = differences([big, small]);
  assert.deepEqual(rest, []);
  assert.equal(only.task, "b");
  assert.equal(only.label, "standard");
  assert.deepEqual([only.decisions.big.route, only.decisions.big.likeliest], ["standard", "standard"]);
  assert.deepEqual([only.decisions.small.route, only.decisions.small.likeliest], ["standard", "lookup"]);
  assert.deepEqual(only.decisions.small.probabilities, { lookup: 0.6, standard: 0.3, open_ended: 0.1 });
  const reordered = { ...small, rows: [...small.rows].reverse() };
  assert.equal(differences([big, reordered]).length, 1);
  assert.throws(() => differences([big, { ...small, rows: small.rows.slice(1) }]), /small has no answer for task: a/);
});
