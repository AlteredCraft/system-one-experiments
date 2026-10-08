import assert from "node:assert/strict";
import { test } from "node:test";
import { backendConfig, deciderFromEnv, JevDecider, score } from "../src/index.mjs";

const questions = { work: { type: "score", instructions: "i", criteria: ["a", "b"] } };
const ok = (model = "jev-1.13.0") =>
  new Response(JSON.stringify({ model, usage: {}, answers: { work: score([0.2, 0.8]) } }), { status: 200 });

function recording(response = ok) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return response();
  };
  return { seen, fetchImpl };
}

test("TypeSafe is the default backend, configured from the environment", () => {
  const c = backendConfig("typesafe", { TYPESAFE_API_KEY: "sk-test", TYPESAFE_DEFAULT_MODEL: "jev-1.13.0" });
  assert.equal(deciderFromEnv({ TYPESAFE_API_KEY: "sk-test" }).label, "TypeSafe Jev");
  assert.deepEqual(c, {
    label: "TypeSafe Jev",
    baseUrl: "https://api.typesafe.ai",
    apiKey: "sk-test",
    keyRequired: true,
    model: "jev-1.13.0",
    timeoutMs: 5000,
  });
  assert.equal(backendConfig("typesafe", {}).model, "jev-latest");
});

test("Open Jev needs no key and has no model to ask for", () => {
  assert.deepEqual(backendConfig("openjev", {}), {
    label: "Open Jev",
    baseUrl: "http://127.0.0.1:3002",
    apiKey: "",
    keyRequired: false,
    model: "",
    timeoutMs: 30000,
  });
  const c = backendConfig("openjev", { OPENJEV_URL: "http://10.0.0.5:3002/", OPENJEV_TOKEN: "tok" });
  assert.equal(c.baseUrl, "http://10.0.0.5:3002/");
  assert.equal(c.apiKey, "tok");
});

test("an unknown backend is an error that names the known ones", () => {
  assert.throws(() => backendConfig("gpt", {}), /unknown backend "gpt": use typesafe or openjev/);
});

test("the config file picks the decision model and the environment overrides it", async () => {
  const { seen, fetchImpl } = recording();
  const fromFile = deciderFromEnv({ TYPESAFE_API_KEY: "k" }, { model: "jev-1.13.0", timeoutMs: 800 }, { fetchImpl });
  assert.equal(fromFile.label, "TypeSafe Jev");
  assert.equal(fromFile.timeoutMs, 800);
  await fromFile.decide({}, questions);
  assert.equal(seen[0].body.model, "jev-1.13.0");

  const pinned = deciderFromEnv({ TYPESAFE_API_KEY: "k", TYPESAFE_DEFAULT_MODEL: "jev-1.12.0" }, { model: "jev-1.13.0" });
  assert.equal(pinned.model, "jev-1.12.0");

  assert.equal(deciderFromEnv({}, { backend: "openjev" }).label, "Open Jev");
  assert.equal(deciderFromEnv({ JEV_BACKEND: "typesafe", TYPESAFE_API_KEY: "k" }, { backend: "openjev" }).label, "TypeSafe Jev");
});

test("JevDecider sends the System One wire format with a bearer key", async () => {
  const { seen, fetchImpl } = recording();
  const decider = new JevDecider({ ...backendConfig("typesafe", { TYPESAFE_API_KEY: "sk-test" }), fetchImpl });
  const out = await decider.decide({ task: "t" }, questions);

  assert.equal(seen[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(seen[0].body, { state: { task: "t" }, model: "jev-latest", questions });
  assert.equal(out.model, "jev-1.13.0");
  assert.equal(out.answers.work.type, "score");
});

test("Open Jev is called at its own URL, with no Authorization header unless it has a token", async () => {
  const { seen, fetchImpl } = recording(() => ok("openjev-MLX-4bit"));
  const env = { OPENJEV_URL: "http://127.0.0.1:3002/" };
  const out = await new JevDecider({ ...backendConfig("openjev", env), fetchImpl }).decide({}, questions);
  assert.equal(seen[0].url, "http://127.0.0.1:3002/v1/systemone");
  assert.ok(!("Authorization" in seen[0].init.headers));
  assert.equal(out.model, "openjev-MLX-4bit");

  await new JevDecider({ ...backendConfig("openjev", { ...env, OPENJEV_TOKEN: "tok" }), fetchImpl }).decide({}, questions);
  assert.equal(seen[1].init.headers.Authorization, "Bearer tok");
});

test("JevDecider surfaces HTTP errors and missing answers", async () => {
  const base = backendConfig("typesafe", { TYPESAFE_API_KEY: "k" });
  const failing = new JevDecider({ ...base, fetchImpl: async () => new Response("slow down", { status: 429 }) });
  await assert.rejects(failing.decide({}, questions), /HTTP 429 slow down/);

  const partial = new JevDecider({
    ...base,
    fetchImpl: async () => new Response(JSON.stringify({ model: "m", answers: {} }), { status: 200 }),
  });
  await assert.rejects(partial.decide({}, questions), /missing answer work/);
});

test("TypeSafe refuses to start without a key", () => {
  assert.throws(() => new JevDecider(backendConfig("typesafe", {})), /no API key/);
  assert.throws(() => deciderFromEnv({}), /no API key/);
});

test("the scripted score builder mirrors the wire format", () => {
  const answer = score([0, 0.57, 0.43]);
  assert.deepEqual(answer.probabilities, { 0: 0, 1: 0.57, 2: 0.43 });
  assert.ok(Math.abs(answer.score - 1.43) < 1e-9);
  assert.equal(answer.type, "score");
});
