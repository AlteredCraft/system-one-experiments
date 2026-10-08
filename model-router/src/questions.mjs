/* Build the System One request for one sub-agent task.

     work  Score  which route's description fits the task (levels = routes, cheapest first)

   A Score, not a Choice, because the routes are ordered: its per-level
   probabilities let policy ask "how likely is it that this task needs more
   than route N?", which a pick among unordered options can't answer.

   Level descriptions come from the config, and no model name is sent. */

export const MAX_TASK_CHARS = 8000;

export const QUESTION = "work";

/** `task` is what the orchestrator would hand the sub-agent: { task, agent_type?, tools? }. */
export function buildState(task) {
  const state = { task: String(task.task).slice(0, MAX_TASK_CHARS) };
  if (task.agent_type) state.agent_type = task.agent_type;
  if (task.tools?.length) state.tools = task.tools;
  return state;
}

export function buildQuestions(config) {
  return {
    [QUESTION]: {
      type: "score",
      instructions: "Which description fits the work that `task` asks a sub-agent to do?",
      criteria: config.routes.map((r) => r.suits),
    },
  };
}
