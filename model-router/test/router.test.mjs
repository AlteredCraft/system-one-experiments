import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  buildQuestions,
  buildState,
  createRouter,
  deciderFromEnv,
  MAX_TASK_CHARS,
  score,
  ScriptedDecider,
} from "../src/index.mjs";

const config = JSON.parse(readFileSync(new URL("../examples/router.config.json", import.meta.url), "utf8"));
const answering = (probabilities) => new ScriptedDecider({ answers: { work: score(probabilities) } });

test("one Score question whose levels are the routes, cheapest first", () => {
  const q = buildQuestions(config);
  assert.deepEqual(Object.keys(q), ["work"]);
  assert.equal(q.work.type, "score");
  assert.deepEqual(
    q.work.criteria,
    config.routes.map((r) => r.suits),
  );
});

test("the state is the task as the orchestrator wrote it, without the model names", () => {
  const state = buildState({ task: "Find every caller of parseConfig", agent_type: "general-purpose", tools: ["Read", "Grep"] });
  assert.deepEqual(state, { task: "Find every caller of parseConfig", agent_type: "general-purpose", tools: ["Read", "Grep"] });
  assert.deepEqual(buildState({ task: "t" }), { task: "t" });
  assert.equal(buildState({ task: "x".repeat(MAX_TASK_CHARS + 50) }).task.length, MAX_TASK_CHARS);
  assert.ok(!JSON.stringify([state, buildQuestions(config)]).includes("claude-"));
});

test("the model's answer picks the route and the decision says how", async () => {
  const decider = answering([0.05, 0.85, 0.1]);
  const router = createRouter({ config, decider });
  const d = await router.route({ task: "Add a --dry-run flag to the sync command", agent_type: "general-purpose" });

  assert.equal(d.source, "model");
  assert.equal(d.route, "standard");
  assert.equal(d.model, "claude-sonnet-5-5");
  assert.equal(d.decisionModel, "scripted");
  assert.equal(typeof d.latencyMs, "number");
  assert.equal(decider.calls.length, 1);
  assert.deepEqual(decider.calls[0].state, { task: "Add a --dry-run flag to the sync command", agent_type: "general-purpose" });
  assert.deepEqual(decider.calls[0].questions, buildQuestions(config));
});

test("a model the orchestrator pinned is used without asking", async () => {
  const decider = answering([1, 0, 0]);
  const d = await createRouter({ config, decider }).route({ task: "anything", model: "claude-fable-5-1" });
  assert.deepEqual(d, { source: "pinned", route: null, model: "claude-fable-5-1" });
  assert.equal(decider.calls.length, 0);
});

test("a rule decides without asking", async () => {
  const decider = answering([0, 0, 1]);
  const d = await createRouter({ config, decider }).route({ task: "Work out why the cache is stale", agent_type: "Explore" });
  assert.deepEqual(d, { source: "rule", route: "lookup", model: "claude-haiku-5-5", rule: config.rules[0] });
  assert.equal(decider.calls.length, 0);
});

test("an unreachable decision model falls back to the configured route", async () => {
  const broken = new ScriptedDecider(() => {
    throw new Error("network down");
  });
  const d = await createRouter({ config, decider: broken }).route({ task: "anything" });
  assert.equal(d.source, "fallback");
  assert.equal(d.route, "standard");
  assert.equal(d.model, "claude-sonnet-5-5");
  assert.match(d.error, /network down/);
});

test("an answer the policy can't read falls back too", async () => {
  const d = await createRouter({ config, decider: answering([0.5, 0.5]) }).route({ task: "anything" });
  assert.equal(d.source, "fallback");
  assert.match(d.error, /probability for route open_ended/);

  const missing = await createRouter({ config, decider: new ScriptedDecider({ answers: {} }) }).route({ task: "anything" });
  assert.equal(missing.source, "fallback");
});

test("with no decision model, rules still apply and everything else falls back", async () => {
  const router = createRouter({ config, decider: null });
  assert.equal((await router.route({ task: "t", agent_type: "Explore" })).source, "rule");
  const d = await router.route({ task: "t" });
  assert.equal(d.source, "fallback");
  assert.match(d.error, /no decision model/);
});

test("every decision names a configured route, whatever the model returns", async () => {
  const models = new Set(config.routes.map((r) => r.model));
  for (const probabilities of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.34, 0.33, 0.33], [0, 0, 0], [0.2, 0.2]]) {
    const d = await createRouter({ config, decider: answering(probabilities) }).route({ task: "t" });
    assert.ok(models.has(d.model), `${JSON.stringify(probabilities)} -> ${d.model}`);
  }
});

test("a task without text is the harness's mistake, not a routing decision", async () => {
  const router = createRouter({ config, decider: answering([1, 0, 0]) });
  await assert.rejects(router.route({ task: "  " }), TypeError);
  await assert.rejects(router.route({}), TypeError);
});

test("an invalid config is refused when the router is made", () => {
  assert.throws(() => createRouter({ config: { ...config, fallback: "nope" }, decider: null }), /invalid router config/);
});

test("a decision model that doesn't answer in time costs the timeout, then the fallback route", async () => {
  const server = createServer(() => {}).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const env = { JEV_BACKEND: "openjev", OPENJEV_URL: `http://127.0.0.1:${server.address().port}` };
    const d = await createRouter({ config, decider: deciderFromEnv(env, { timeoutMs: 50 }) }).route({ task: "anything" });
    assert.equal(d.source, "fallback");
    assert.equal(d.model, "claude-sonnet-5-5");
    assert.ok(d.latencyMs < 1000, `${d.latencyMs} ms`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("over HTTP, a System One server's answer comes back as a decision", async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: "openjev-test", usage: {}, answers: { work: score([0.02, 0.08, 0.9]) } }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const env = { JEV_BACKEND: "openjev", OPENJEV_URL: `http://127.0.0.1:${server.address().port}` };
    const d = await createRouter({ config, decider: deciderFromEnv(env) }).route({ task: "Work out why the cache is stale" });
    assert.equal(d.source, "model");
    assert.equal(d.model, "claude-opus-5-5");
    assert.equal(d.decisionModel, "openjev-test");
    assert.deepEqual(seen[0].state, { task: "Work out why the cache is stale" });
    assert.equal(seen[0].questions.work.criteria.length, 3);
  } finally {
    server.close();
  }
});
