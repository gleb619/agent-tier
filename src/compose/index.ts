export type { ComposeCliDeps, ComposeCliOptions } from "./cli";
export { createComposeDeps, registerComposeCommand } from "./cli";
export type { CommandResult, ComposeDeps, ComposeOptions, ComposeResult } from "./machine";
export { ComposeError, runCompose } from "./machine";
export { allDone, parseChecklist, parseVerdict, pendingItems, setChecked } from "./md-state";
export { buildCheckPrompt, buildImplementPrompt, buildPlanPrompt } from "./prompts";
export type { ComposePhase, ComposeState } from "./state";
export { createState, loadState, STATE_FILE, saveState } from "./state";
export { CONTEXT_FILE, ComposeWorkspace, PLAN_FILE, VERDICT_FILE } from "./workspace";
