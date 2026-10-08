import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decisionFrom, DEFAULTS, matchRule, riskBar, score, validateConfig } from "../src/index.mjs";

const config = JSON.parse(readFileSync(new URL("../examples/router.config.json", import.meta.url), "utf8"));
const withBar = (maxUnderRouteRisk) => ({ ...config, maxUnderRouteRisk });

test("the example config is valid", () => {
  assert.deepEqual(validateConfig(config), []);
});

test("a confident answer takes the likeliest route", () => {
  const d = decisionFrom(config, score([0.9, 0.08, 0.02]));
  assert.equal(d.route, "lookup");
  assert.equal(d.model, "claude-haiku-5-5");
  assert.equal(d.likeliest, "lookup");
  assert.equal(d.escalated, false);
  assert.ok(Math.abs(d.risk - 0.1) < 1e-9);
  assert.deepEqual(d.probabilities, { lookup: 0.9, standard: 0.08, open_ended: 0.02 });
});

test("when a cheaper route is too likely to fall short, the next one up is taken", () => {
  const d = decisionFrom(config, score([0.6, 0.3, 0.1]));
  assert.equal(d.likeliest, "lookup");
  assert.equal(d.route, "standard");
  assert.equal(d.escalated, true);
  assert.ok(Math.abs(d.risk - 0.1) < 1e-9);
});

test("the bar is policy: the same answer routes differently as it moves", () => {
  const answer = score([0.6, 0.3, 0.1]);
  assert.equal(decisionFrom(withBar(0.5), answer).route, "lookup");
  assert.equal(decisionFrom(withBar(0.25), answer).route, "standard");
  assert.equal(decisionFrom(withBar(0.05), answer).route, "open_ended");
});

test("a config without a bar uses the default", () => {
  const { maxUnderRouteRisk, ...noBar } = config;
  assert.equal(riskBar(noBar), DEFAULTS.maxUnderRouteRisk);
  assert.equal(riskBar(withBar(0)), 0);
  assert.equal(decisionFrom(noBar, score([0.7, 0.2, 0.1])).route, decisionFrom(withBar(DEFAULTS.maxUnderRouteRisk), score([0.7, 0.2, 0.1])).route);
});

test("risk exactly at the bar is accepted", () => {
  assert.equal(decisionFrom(withBar(0.25), score([0.75, 0.15, 0.1])).route, "lookup");
});

test("a bar of zero takes the most capable route with any probability", () => {
  assert.equal(decisionFrom(withBar(0), score([0.6, 0.4, 0])).route, "standard");
  assert.equal(decisionFrom(withBar(0), score([0.98, 0.01, 0.01])).route, "open_ended");
});

test("the route is at or above the likeliest one unless the bar exceeds its probability", () => {
  const answer = score([0.3, 0.3, 0.4]);
  assert.equal(decisionFrom(withBar(0.25), answer).route, "open_ended");
  const loose = decisionFrom(withBar(0.5), answer);
  assert.equal(loose.likeliest, "open_ended");
  assert.equal(loose.route, "standard");
  assert.equal(loose.escalated, false);
});

test("a tie for likeliest goes to the more capable route", () => {
  assert.equal(decisionFrom(config, score([0.1, 0.45, 0.45])).likeliest, "open_ended");
});

test("an answer without a probability for every route is rejected", () => {
  assert.throws(() => decisionFrom(config, score([0.5, 0.5])), /probability for route open_ended/);
  assert.throws(() => decisionFrom(config, { type: "score", score: 1 }), /probability for route lookup/);
  assert.throws(
    () => decisionFrom(config, { type: "score", probabilities: { 0: 0.5, 1: "0.5", 2: 0 } }),
    /probability for route standard/,
  );
  assert.throws(() => decisionFrom(config, score([0, 0, 0])), /sum to 0.00, not 1/);
  assert.throws(() => decisionFrom(config, score([0.9, 0.9, 0.9])), /sum to 2.70, not 1/);
});

test("the first rule whose fields all match the task decides", () => {
  const rules = [
    { when: { agent_type: "Explore", depth: "thorough" }, route: "standard" },
    { when: { agent_type: "Explore" }, route: "lookup" },
  ];
  const c = { ...config, rules };
  assert.equal(matchRule(c, { task: "t", agent_type: "Explore", depth: "thorough" }).route, "standard");
  assert.equal(matchRule(c, { task: "t", agent_type: "Explore" }).route, "lookup");
  assert.equal(matchRule(c, { task: "t", agent_type: "Plan" }), null);
  assert.equal(matchRule({ ...config, rules: undefined }, { task: "t", agent_type: "Explore" }), null);
});

test("config problems are all reported", () => {
  const problems = validateConfig({
    routes: [
      { id: "a", model: "m1", suits: "x" },
      { id: "a", model: "", suits: "y" },
      { id: "Bad Id", model: "m3" },
    ],
    fallback: "nope",
    maxUnderRouteRisk: 1.5,
    rules: [{ when: {}, route: "a" }, { when: { agent_type: "Explore" }, route: "missing" }],
    decider: { backend: "gpt" },
  });
  for (const expected of [
    /route id a is repeated/,
    /route a needs a model/,
    /route id "Bad Id" must be snake_case/,
    /route Bad Id needs suits/,
    /fallback nope is not a route/,
    /maxUnderRouteRisk must be a number from 0 to 1/,
    /rule 0 needs at least one field in when/,
    /rule 1 names route missing/,
    /decider.backend gpt is not one of/,
  ]) {
    assert.ok(problems.some((p) => expected.test(p)), `${expected} not in ${JSON.stringify(problems)}`);
  }
});

test("a Score takes 2 to 10 levels, so a config takes 2 to 10 routes", () => {
  const route = (i) => ({ id: `r${i}`, model: "m", suits: "s" });
  assert.match(validateConfig({ routes: [route(0)], fallback: "r0" }).join(), /2 to 10 routes/);
  const eleven = Array.from({ length: 11 }, (_, i) => route(i));
  assert.match(validateConfig({ routes: eleven, fallback: "r0" }).join(), /2 to 10 routes/);
});
