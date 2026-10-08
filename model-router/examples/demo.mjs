/* Route one sub-agent task and print the decision.

     TYPESAFE_API_KEY=sk-... node examples/demo.mjs "Find every caller of parseConfig"
     JEV_BACKEND=openjev node examples/demo.mjs --agent-type general-purpose "Work out why the cache is stale"
     node examples/demo.mjs --json --config my-router.json "..."

   --json prints only the decision, so an orchestrator can call this as a tool
   and read `model` from it. With no decision model reachable it still prints
   a decision: the config's fallback route. */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createRouter, deciderFromEnv, loadConfig } from "../src/index.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: fileURLToPath(new URL("./router.config.json", import.meta.url)) },
    "agent-type": { type: "string" },
    model: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const config = await loadConfig(values.config);
let decider = null;
try {
  decider = deciderFromEnv(process.env, config.decider);
} catch (e) {
  console.error(`${e.message}. Routing by rules and the fallback route only.`);
}

const task = {
  task: positionals.join(" ") || "Checkout intermittently double-charges customers. Find the cause.",
  agent_type: values["agent-type"],
  model: values.model,
};
const decision = await createRouter({ config, decider }).route(task);

if (values.json) {
  console.log(JSON.stringify(decision, null, 2));
} else {
  console.log(`task    ${task.task}`);
  console.log(`model   ${decision.model}  (route ${decision.route ?? "-"}, decided by ${decision.source})`);
  if (decision.source === "model") {
    const p = Object.entries(decision.probabilities).map(([id, v]) => `${id} ${v.toFixed(2)}`);
    console.log(`routes  ${p.join("  ")}`);
    console.log(`risk    ${decision.risk.toFixed(2)} that it needs more than ${decision.route}${decision.escalated ? `  (moved up from ${decision.likeliest})` : ""}`);
    console.log(`asked   ${decider.label}, ${decision.latencyMs.toFixed(0)} ms`);
    console.log(`        ${decision.decisionModel}`);
  }
  if (decision.error) console.log(`error   ${decision.error}`);
}
