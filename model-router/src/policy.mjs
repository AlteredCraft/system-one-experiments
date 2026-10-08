/* Turn a task, or the model's answer about it, into a route. All policy
   lives here, in code, so the bar can move without touching a question.

   Rules go first: a task they match is never sent to the model.

   For the rest, the answer gives a probability for each route. The risk of
   a route is the probability that the task belongs on a more capable one.
   The router takes the cheapest route whose risk is at or under
   `maxUnderRouteRisk`. While the bar is below the likeliest route's own
   probability, that can only keep the task there or move it up; a bar above
   it can settle for a cheaper route than the likeliest.
   The most capable route has no risk, so there is always a route to take. */

import { riskBar } from "./config.mjs";

const EPSILON = 1e-9;
const SUM_TOLERANCE = 0.02; // the API rounds each probability

export function matchRule(config, task) {
  const matches = (rule) => Object.entries(rule.when).every(([field, value]) => task[field] === value);
  return (config.rules ?? []).find(matches) ?? null;
}

export function decisionFrom(config, answer) {
  const { routes } = config;
  const p = routes.map((r, level) => {
    const value = answer?.probabilities?.[level];
    if (typeof value !== "number" || !(value >= 0 && value <= 1)) {
      throw new Error(`the answer has no probability for route ${r.id}`);
    }
    return value;
  });
  const total = p.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > SUM_TOLERANCE) throw new Error(`route probabilities sum to ${total.toFixed(2)}, not 1`);

  const riskOf = (level) => p.slice(level + 1).reduce((a, b) => a + b, 0);
  const chosen = routes.findIndex((_, level) => riskOf(level) <= riskBar(config) + EPSILON);
  const likeliest = p.lastIndexOf(Math.max(...p));

  return {
    route: routes[chosen].id,
    model: routes[chosen].model,
    likeliest: routes[likeliest].id,
    escalated: chosen > likeliest,
    risk: riskOf(chosen),
    score: answer.score ?? null,
    confidence: answer.confidence ?? null,
    probabilities: Object.fromEntries(routes.map((r, level) => [r.id, p[level]])),
  };
}
