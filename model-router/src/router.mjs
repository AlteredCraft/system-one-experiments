/* The seam a harness calls before it spawns a sub-agent:

     const router = createRouter({ config, decider });
     const { model } = await router.route({ task: prompt, agent_type: "general-purpose" });

   What decides, in order (each decision says which in `source`):
     pinned    the orchestrator already named a model: use it, ask nothing
     rule      a config rule matches the task: use its route, ask nothing
     model     one System One request, then policy.mjs
     fallback  the decision model failed, or there is none: the config's fallback route

   route() never fails because of the decision model: a sub-agent that
   starts on the fallback model is better than one that doesn't start. */

import { assertConfig } from "./config.mjs";
import { decisionFrom, matchRule } from "./policy.mjs";
import { buildQuestions, buildState, QUESTION } from "./questions.mjs";

export function createRouter({ config, decider }) {
  assertConfig(config);
  const questions = buildQuestions(config);
  const byId = Object.fromEntries(config.routes.map((r) => [r.id, r]));
  const fallback = byId[config.fallback];

  return {
    async route(task) {
      if (typeof task?.task !== "string" || !task.task.trim()) throw new TypeError("task.task must be the task's text");

      if (task.model) return { source: "pinned", route: null, model: task.model };

      const rule = matchRule(config, task);
      if (rule) return { source: "rule", route: rule.route, model: byId[rule.route].model, rule };

      const started = performance.now();
      try {
        if (!decider) throw new Error("no decision model configured");
        const { model, answers } = await decider.decide(buildState(task), questions);
        const decision = decisionFrom(config, answers?.[QUESTION]);
        return { source: "model", ...decision, decisionModel: model, latencyMs: performance.now() - started };
      } catch (error) {
        return {
          source: "fallback",
          route: fallback.id,
          model: fallback.model,
          error: error.message,
          latencyMs: performance.now() - started,
        };
      }
    },
  };
}
