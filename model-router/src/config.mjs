/* A router config: the models a sub-agent can run on, and how to choose.

   {
     routes: [                                // cheapest first: the order is the capability order
       { id: "lookup", model: "claude-haiku-5-5", suits: "Finding, reading ... what already exists." },
       { id: "standard", model: "claude-sonnet-5-5", suits: "Writing or changing code to a clear spec ..." },
     ],
     fallback: "standard",                    // the route when the decision model can't be asked
     maxUnderRouteRisk: 0.25,                 // optional: see policy.mjs
     rules: [{ when: { agent_type: "Explore" }, route: "lookup" }],   // optional: decided without asking
     decider: { backend: "typesafe", model: "jev-1.13.0", timeoutMs: 5000 },  // optional: see decider.mjs
   }

   `suits` is the only part of a route the decision model reads. It describes
   the work, not the model: Jev can judge what a task asks for, and knows
   nothing about what claude-haiku-5-5 is good at. */

import { readFile } from "node:fs/promises";
import { BACKENDS } from "./decider.mjs";

export const MIN_ROUTES = 2; // a Score takes 2 to 10 levels
export const MAX_ROUTES = 10;

export const DEFAULTS = Object.freeze({
  // P(the task needs a more capable route than the one chosen) the router accepts.
  // Sending a task too low costs a failed or poor result; too high only costs money.
  maxUnderRouteRisk: 0.25,
});

export const riskBar = (config) => config.maxUnderRouteRisk ?? DEFAULTS.maxUnderRouteRisk;

const ID = /^[a-z][a-z0-9_]*$/;

export function validateConfig(config) {
  if (!config || typeof config !== "object") return ["config must be an object"];
  const problems = [];
  const routes = Array.isArray(config.routes) ? config.routes : [];
  if (routes.length < MIN_ROUTES || routes.length > MAX_ROUTES) {
    problems.push(`list ${MIN_ROUTES} to ${MAX_ROUTES} routes, cheapest first`);
  }
  const ids = new Set();
  for (const r of routes) {
    if (!ID.test(r?.id ?? "")) problems.push(`route id ${JSON.stringify(r?.id)} must be snake_case`);
    else if (ids.has(r.id)) problems.push(`route id ${r.id} is repeated`);
    ids.add(r?.id);
    if (!r?.model) problems.push(`route ${r?.id} needs a model`);
    if (!r?.suits) problems.push(`route ${r?.id} needs suits (the work it is for)`);
  }
  if (!ids.has(config.fallback)) problems.push(`fallback ${config.fallback} is not a route`);

  const risk = config.maxUnderRouteRisk;
  if (risk !== undefined && !(typeof risk === "number" && risk >= 0 && risk <= 1)) {
    problems.push("maxUnderRouteRisk must be a number from 0 to 1");
  }

  const rules = config.rules ?? [];
  if (!Array.isArray(rules)) problems.push("rules must be a list");
  for (const [i, rule] of (Array.isArray(rules) ? rules : []).entries()) {
    if (!rule?.when || typeof rule.when !== "object" || Object.keys(rule.when).length === 0) {
      problems.push(`rule ${i} needs at least one field in when`);
    }
    if (!ids.has(rule?.route)) problems.push(`rule ${i} names route ${rule?.route}, which is not a route`);
  }

  const backend = config.decider?.backend;
  if (backend !== undefined && !BACKENDS.includes(backend)) {
    problems.push(`decider.backend ${backend} is not one of ${BACKENDS.join(", ")}`);
  }
  return problems;
}

export function assertConfig(config) {
  const problems = validateConfig(config);
  if (problems.length) throw new Error(`invalid router config: ${problems.join("; ")}`);
  return config;
}

export async function loadConfig(path) {
  return assertConfig(JSON.parse(await readFile(path, "utf8")));
}
