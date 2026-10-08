/* The port to the decision model, and two adapters.

   A decider takes (state, questions) and resolves to { model, answers },
   where answers mirrors the System One wire format:
     score: { type: "score", score, confidence, probabilities: { "0": p, "1": p, ... } }

   JevDecider calls a System One REST API with fetch: TypeSafe's, or an Open
   Jev server, which takes the same requests. ScriptedDecider is for tests.

   Which one answers comes from the config's `decider` block, and the
   environment overrides it so a run can switch without editing a file:

     JEV_BACKEND=typesafe  (default) TypeSafe's hosted API. Reads TYPESAFE_API_KEY,
                           TYPESAFE_DEFAULT_MODEL and TYPESAFE_BASE_URL.
     JEV_BACKEND=openjev   an Open Jev server on your own machine. Reads OPENJEV_URL
                           (default http://127.0.0.1:3002) and OPENJEV_TOKEN, needed
                           only if the server was started with SHIM_TOKEN.

   Keys and URLs come from the environment only, never the config file. */

export const BACKENDS = Object.freeze(["typesafe", "openjev"]);

export function backendConfig(backend, env) {
  switch (backend) {
    case "typesafe":
      return {
        label: "TypeSafe Jev",
        baseUrl: env.TYPESAFE_BASE_URL || "https://api.typesafe.ai",
        apiKey: env.TYPESAFE_API_KEY || "",
        keyRequired: true,
        model: env.TYPESAFE_DEFAULT_MODEL || "jev-latest",
        timeoutMs: 5000,
      };
    case "openjev":
      // It answers with whichever model it was started with, so there is no
      // model to ask for. On a laptop a cold first answer can take a few seconds.
      return {
        label: "Open Jev",
        baseUrl: env.OPENJEV_URL || "http://127.0.0.1:3002",
        apiKey: env.OPENJEV_TOKEN || "",
        keyRequired: false,
        model: "",
        timeoutMs: 30000,
      };
    default:
      throw new Error(`unknown backend "${backend}": use ${BACKENDS.join(" or ")}`);
  }
}

/** `settings` is the config's `decider` block: { backend?, model?, timeoutMs? }. */
export function deciderFromEnv(env = process.env, settings = {}, { fetchImpl } = {}) {
  const backend = env.JEV_BACKEND || settings.backend || "typesafe";
  const config = backendConfig(backend, env);
  if (backend === "typesafe" && settings.model && !env.TYPESAFE_DEFAULT_MODEL) config.model = settings.model;
  if (settings.timeoutMs) config.timeoutMs = settings.timeoutMs;
  return new JevDecider({ ...config, fetchImpl });
}

export class JevDecider {
  constructor({ label, baseUrl, apiKey = "", keyRequired = true, model, timeoutMs, fetchImpl = globalThis.fetch }) {
    if (keyRequired && !apiKey) throw new Error("no API key: set TYPESAFE_API_KEY, or JEV_BACKEND=openjev");
    Object.assign(this, { label, baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model, timeoutMs, fetchImpl });
  }

  async decide(state, questions) {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers,
      body: JSON.stringify({ state, model: this.model, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`System One request failed: HTTP ${res.status} ${body}`);
    }
    const data = await res.json();
    for (const name of Object.keys(questions)) {
      const answer = data.answers?.[name];
      if (!answer || answer.type !== questions[name].type) throw new Error(`response is missing answer ${name}`);
    }
    return { model: data.model, answers: data.answers };
  }
}

/** Returns scripted answers. `script` is { model?, answers } or (state, questions) => that. */
export class ScriptedDecider {
  constructor(script) {
    this.script = script;
    this.calls = [];
  }

  async decide(state, questions) {
    this.calls.push({ state, questions });
    const out = typeof this.script === "function" ? await this.script(state, questions) : this.script;
    return { model: "scripted", ...out };
  }
}

/** A Score answer from per-level probabilities, lowest level first. For tests and fixtures. */
export function score(probabilities, confidence = Math.max(...probabilities)) {
  return {
    type: "score",
    score: probabilities.reduce((sum, p, level) => sum + p * level, 0),
    confidence,
    probabilities: Object.fromEntries(probabilities.map((p, level) => [level, p])),
  };
}
