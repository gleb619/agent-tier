import type { WebSettings } from "$stores/settings";
import { isRunMode, MAX_RETRIES } from "./newtask";

export const MAX_SSE_PORT = 65535;

/** Keys the settings form edits; every other stored key is shown read-only. */
export const KNOWN_SETTING_KEYS = [
  "defaultTier",
  "defaultAgent",
  "runMode",
  "retries",
  "autoRefresh",
  "ssePort",
  "logDir",
  "stateDir",
] as const;

/** Editable mirror of the settings store; numeric fields are held as strings for form binding. */
export interface SettingsForm {
  /** "1"-"4" — defaults must be concrete, there is no "Auto" tier here. */
  defaultTier: string;
  /** Agent name, or "" for "Auto" (round-robin within the tier). */
  defaultAgent: string;
  runMode: string;
  retries: string;
  autoRefresh: boolean;
  /** "" = unset (the stored key is dropped on save). */
  ssePort: string;
  logDir: string;
  stateDir: string;
}

export type SettingsFormErrors = Partial<Record<keyof SettingsForm, string>>;

export function formFromSettings(s: WebSettings): SettingsForm {
  return {
    defaultTier: Number.isInteger(s.defaultTier) ? String(s.defaultTier) : "2",
    defaultAgent: typeof s.defaultAgent === "string" ? s.defaultAgent : "",
    runMode: isRunMode(s.runMode) ? s.runMode : "stream",
    retries: Number.isFinite(s.retries) ? String(Math.trunc(s.retries)) : "0",
    autoRefresh: s.autoRefresh !== false,
    ssePort: Number.isFinite(s.ssePort) ? String(Math.trunc(s.ssePort as number)) : "",
    logDir: typeof s.logDir === "string" ? s.logDir : "",
    stateDir: typeof s.stateDir === "string" ? s.stateDir : "",
  };
}

/** Per-field validation; returns an empty object when the form is valid. */
export function validateSettingsForm(form: SettingsForm, knownAgents: string[] = []): SettingsFormErrors {
  const errors: SettingsFormErrors = {};
  const tier = Number(form.defaultTier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) errors.defaultTier = "Tier must be 1, 2, 3 or 4.";
  if (form.defaultAgent !== "" && knownAgents.length > 0 && !knownAgents.includes(form.defaultAgent)) {
    errors.defaultAgent = `Unknown agent: ${form.defaultAgent}.`;
  }
  if (!isRunMode(form.runMode)) errors.runMode = "Mode must be stream, block or detached.";
  const retries = Number(form.retries);
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) {
    errors.retries = `Retries must be an integer between 0 and ${MAX_RETRIES}.`;
  }
  if (form.ssePort.trim() !== "") {
    const port = Number(form.ssePort);
    if (!Number.isInteger(port) || port < 1 || port > MAX_SSE_PORT) {
      errors.ssePort = `SSE port must be an integer between 1 and ${MAX_SSE_PORT}.`;
    }
  }
  return errors;
}

/** Coerce the form into a settings patch; empty advanced fields are `undefined` so the stored key is dropped. */
export function settingsPatchFromForm(form: SettingsForm): Partial<WebSettings> {
  const ssePort = form.ssePort.trim();
  const logDir = form.logDir.trim();
  const stateDir = form.stateDir.trim();
  return {
    defaultTier: Number(form.defaultTier),
    defaultAgent: form.defaultAgent,
    runMode: form.runMode as WebSettings["runMode"],
    retries: Number(form.retries),
    autoRefresh: form.autoRefresh,
    ssePort: ssePort === "" ? undefined : Number(ssePort),
    logDir: logDir === "" ? undefined : logDir,
    stateDir: stateDir === "" ? undefined : stateDir,
  };
}

/** Stored keys the form does not edit (e.g. state/config paths written by other clients), for read-only display. */
export function extraSettingsEntries(s: WebSettings): [string, string][] {
  return Object.entries(s)
    .filter(([key]) => !(KNOWN_SETTING_KEYS as readonly string[]).includes(key))
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]);
}
