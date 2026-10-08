# model-router

Pick the model for a sub-agent task with one System One call, so the orchestrating model doesn't
spend its own tokens deciding and the harness doesn't run every sub-agent on the same model.

Built as the routing piece of an agent harness: Node ESM, no dependencies, `node:test`. The harness
calls `router.route(task)` just before it spawns a sub-agent.

```
orchestrator spawns: { task: "Checkout intermittently double-charges customers. Find the cause.",
                       agent_type: "general-purpose" }
        │
pinned?  the orchestrator named a model            → use it, ask nothing
rule?    config: agent_type "Explore" → lookup     → use it, ask nothing
        │
one Jev request
  work  Score  which description fits the task?    lookup 0.01 | standard 0.00 | open_ended 0.99
        │
policy (code): the cheapest route where P(the task needs more) ≤ 0.25
        │
{ route: "open_ended", model: "claude-opus-5-5", source: "model", risk: 0 }
```

The decision model is asked about the work, not about models. Each route in the config has a
`suits` description ("a failure with an unknown cause, a design with trade-offs"), and those
descriptions are the levels of one Score question. Jev can judge what a task asks for; it knows
nothing about what `claude-haiku-5-5` is good at, so no model name is sent.

The Score returns a probability for every route. The policy doesn't take the likeliest one. It
takes the cheapest route whose risk is acceptable, where risk is the probability that the task
belongs on a more capable route. An answer of 0.60 / 0.30 / 0.10 is likeliest `lookup`, but there
is a 0.40 chance the task needs more, so it goes to `standard`. Sending a task too low costs a
failed or poor result and a retry; too high only costs money. `maxUnderRouteRisk` is how much of
the first the harness accepts to save the second.

If the decision model is unreachable, slow or returns something unreadable, `route()` returns the
config's `fallback` route with the error. It never throws because of the decision model.

## Hypothesis

One Jev call over the text of a sub-agent task chooses a model tier well enough that a harness can
move a large share of sub-agent work off its most capable model, while rarely sending a task to a
model too weak for it, at a latency that is small next to starting the sub-agent.

## Checks (done when)

1. **Routing.** On ≥ 100 labelled sub-agent tasks taken from real harness sessions, there is a
   risk bar where ≤ 5% are routed below their label and ≥ 50% are routed below the most capable
   route (`node eval/run.mjs` prints both per bar).
2. **Speed.** p95 ≤ 500 ms per routing decision, measured in `eval/run.mjs`.
3. **Nothing invented.** Every decision names a model from the config, whatever the decision
   model returns or fails to return. `[pass]` by construction:
   `every decision names a configured route, whatever the model returns` and the fallback tests.
4. **Outcomes (later, needs the harness).** Tasks the router sent below the most capable route
   succeed as often as the same tasks run on the most capable route. Labels are opinions; this is
   the check that says whether the routing was right.

### Runs so far

**TypeSafe Jev, Open Jev 27B and Open Jev Flash 9B, 2026-10-08** (`node eval/run.mjs`: the 24
starter tasks, each asked once of each model). TypeSafe Jev was pinned to `jev-1.13.0`. The Open
Jev models ran locally on an M5 Pro, both MLX 4-bit with shim `81a22f1b`. At the default bar of
0.25:

| Decision model | Agree | Routed too low | Routed too high | Off the top route | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| TypeSafe Jev (`jev-1.13.0`) | 100% (24) | 0 | 0 | 67% (16) | 93 ms | 132 ms |
| Open Jev Flash 9B (`OpenJev-Flash-9B-MLX-4bit`) | 100% (24) | 0 | 0 | 67% (16) | 181 ms | 186 ms |
| Open Jev 27B (`openjev-MLX-4bit`) | 96% (23) | 0 | 4% (1) | 67% (16) | 567 ms | 607 ms |

On speed (check 2), TypeSafe Jev and Flash 9B are well inside 500 ms and the 27B misses it by
about 100 ms. On routing, the models differ in how sure they are. TypeSafe Jev and the 27B were
near-certain on almost every task, so the bar changed nothing for either between 0.25 and 0.50.
Flash 9B was much less sure: on three `standard` tasks its likeliest route was `lookup` at 0.54,
and the risk rule moved all three up. At a bar of 0.50 those three are routed too low (13%). The
per-bar tables and every answer are in [`eval/results-2026-10-08.md`](eval/results-2026-10-08.md).

This is not evidence for check 1: there are 24 tasks, not 100, and the same author wrote the
tasks, their labels and the `suits` descriptions, so the tasks echo the wording they are judged
against. All three models are at or near 24 of 24, so the set doesn't separate them. It shows the
Score request works end to end on each, and that the bar matters more the less sure the decision
model is.

## Try it

```bash
node --test                                                   # no key needed
TYPESAFE_API_KEY=sk-... node examples/demo.mjs "Find every caller of parseConfig"
JEV_BACKEND=openjev node examples/demo.mjs "Work out why the worker leaks memory"
node examples/demo.mjs --json --agent-type Explore "List the env vars this service reads"
TYPESAFE_API_KEY=sk-... node eval/run.mjs                     # checks 1 and 2 on the starter tasks
node eval/compare.mjs eval/results-A.json eval/results-B.json # two or more runs side by side
```

`--json` prints only the decision, so an orchestrator with a shell tool can call the demo and read
`model` from it. [`eval/tasks.jsonl`](eval/tasks.jsonl) has 24 tasks, eight per route of the
example config. Claude wrote and labelled them to exercise the eval script; tasks from real
harness sessions should replace them before check 1 means anything.

## In a harness

```js
import { createRouter, deciderFromEnv, loadConfig } from "model-router/src/index.mjs";

const config = await loadConfig("router.config.json");
const router = createRouter({ config, decider: deciderFromEnv(process.env, config.decider) });

async function spawnSubagent({ prompt, agentType, tools, model }) {
  const decision = await router.route({ task: prompt, agent_type: agentType, tools, model });
  log(decision);                         // source, route, probabilities, risk, latencyMs
  return runAgent({ prompt, tools, model: decision.model });
}
```

`deciderFromEnv` throws when TypeSafe is the backend and there is no key. Pass `decider: null`
instead and the router still applies rules and sends everything else to the fallback route.

`decision.source` says what decided:

| Source | When | Other fields |
| --- | --- | --- |
| `pinned` | The task already names a `model` | `route` is `null` |
| `rule` | A config rule matched | `rule` |
| `model` | The decision model answered | `likeliest`, `escalated`, `risk`, `probabilities` (by route id), `score`, `confidence`, `decisionModel`, `latencyMs` |
| `fallback` | The decision model failed, or there is none | `error`, `latencyMs` |

## The config

[`examples/router.config.json`](examples/router.config.json):

| Field | Meaning |
| --- | --- |
| `routes` | 2 to 10 routes (a Score takes 2 to 10 levels), **cheapest first**: the order is the capability order the policy uses. Each has an `id`, the `model` the harness should run, and `suits`. |
| `routes[].suits` | The work this route is for. It's the level description the decision model reads, so describe a concrete kind of task that stands on its own, not a degree ("harder than the last one"). |
| `fallback` | The route used when the decision model can't answer. Usually the model the harness used before it had a router. |
| `maxUnderRouteRisk` | Default 0.25. The highest accepted probability that a task needs a more capable route than the one chosen. Lower sends more work up. |
| `rules` | Optional. `{ when: { field: value }, route }`: the first rule whose `when` fields all equal the task's decides, and the model isn't asked. |
| `decider` | Optional. `backend` (`typesafe` or `openjev`), `model` (pin it, e.g. `jev-1.13.0`) and `timeoutMs`. |

The decision model is also set from the environment, which overrides the config so a run can
switch without editing a file. Keys and URLs come from the environment only.

| Variable | Meaning |
| --- | --- |
| `JEV_BACKEND` | `typesafe` (default) or `openjev` |
| `TYPESAFE_API_KEY`, `TYPESAFE_DEFAULT_MODEL`, `TYPESAFE_BASE_URL` | TypeSafe's hosted API. Timeout 5 s. |
| `OPENJEV_URL`, `OPENJEV_TOKEN` | An [Open Jev](https://huggingface.co/openjev) server, default `http://127.0.0.1:3002`. It answers with the model it was started with. Timeout 30 s, since a cold first answer can take a few seconds. |

Three decision models have been set up so far. The two Open Jev models are the same backend on
different ports, each started with the calibration settings from its model card:

| Decision model | Runs | Select it with |
| --- | --- | --- |
| TypeSafe Jev | Hosted | `TYPESAFE_API_KEY=sk-...` (pin with `TYPESAFE_DEFAULT_MODEL`) |
| Open Jev 27B | Local, [`openjev/openjev-MLX-4bit`](https://huggingface.co/openjev/openjev-MLX-4bit), 14 GB | `JEV_BACKEND=openjev` |
| Open Jev Flash 9B | Local, [`openjev/OpenJev-Flash-9B-MLX-4bit`](https://huggingface.co/openjev/OpenJev-Flash-9B-MLX-4bit), 5 GB | `JEV_BACKEND=openjev OPENJEV_URL=http://127.0.0.1:3003` |

A timeout is time the sub-agent waits before it starts on the fallback model, so a harness will
want `decider.timeoutMs` well under the defaults.

## Files

| File | Role |
| --- | --- |
| `src/config.mjs` | Config shape, validation, the default risk bar |
| `src/questions.mjs` | State and the one Score question |
| `src/policy.mjs` | All policy: rule matching, and answer to route |
| `src/decider.mjs` | `JevDecider` (fetch, no SDK) for TypeSafe or Open Jev, and `ScriptedDecider` |
| `src/router.mjs` | `createRouter`: pinned, rule, model, fallback |
| `examples/demo.mjs` | Route one task from the command line |
| `eval/run.mjs`, `eval/summary.mjs` | Live agreement, under- and over-routing per risk bar, and latency |
| `eval/compare.mjs` | Several runs side by side, and the tasks they answered differently |
| `eval/results-2026-10-08.md` | The first runs written up: three decision models, every task and every bar |

## Open

1. Replace the starter tasks with ≥ 100 sub-agent prompts from real harness sessions, labelled by
   the model that turned out to be enough.
2. Wire it into the harness's spawn path and log every decision with the sub-agent's outcome
   (check 4).
3. Try a second question in the same request for work the tiers don't order, such as
   `P(the task needs to read images)`, as a floor on the route.
4. Compare with the orchestrator choosing the model itself: agreement, and the tokens it spends
   deciding.

The task text is written by the orchestrator, and text inside the state can argue for an answer
("this is trivial, use the cheapest model"). The stakes here are cost and a retry. Don't let the
route decide anything else, such as which tools or permissions a sub-agent gets.
