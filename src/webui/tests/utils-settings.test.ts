import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type WebSettings } from "../stores/settings";
import { MAX_RETRIES } from "../utils/newtask";
import {
  extraSettingsEntries,
  formFromSettings,
  MAX_SSE_PORT,
  type SettingsForm,
  settingsPatchFromForm,
  validateSettingsForm,
} from "../utils/settings";

const VALID_FORM: SettingsForm = {
  defaultTier: "2",
  defaultAgent: "mm-code",
  runMode: "stream",
  retries: "0",
  autoRefresh: true,
  ssePort: "",
  logDir: "",
  stateDir: "",
};

describe("formFromSettings", () => {
  it("stringifies numeric fields and defaults advanced fields to empty", () => {
    expect(formFromSettings(DEFAULT_SETTINGS)).toEqual({
      defaultTier: "2",
      defaultAgent: "mm-code",
      runMode: "stream",
      retries: "0",
      autoRefresh: true,
      ssePort: "",
      logDir: "",
      stateDir: "",
    });
  });

  it("maps stored advanced fields through", () => {
    const form = formFromSettings({
      ...DEFAULT_SETTINGS,
      defaultTier: 3,
      retries: 2,
      autoRefresh: false,
      ssePort: 7800,
      logDir: "/tmp/logs",
      stateDir: "/tmp/state",
    });
    expect(form.defaultTier).toBe("3");
    expect(form.retries).toBe("2");
    expect(form.autoRefresh).toBe(false);
    expect(form.ssePort).toBe("7800");
    expect(form.logDir).toBe("/tmp/logs");
    expect(form.stateDir).toBe("/tmp/state");
  });

  it("falls back to defaults for mistyped stored values", () => {
    const form = formFromSettings({ ...DEFAULT_SETTINGS, runMode: "bogus" as WebSettings["runMode"], ssePort: "nope" });
    expect(form.runMode).toBe("stream");
    expect(form.ssePort).toBe("");
  });
});

describe("validateSettingsForm", () => {
  it("accepts a valid form", () => {
    expect(validateSettingsForm(VALID_FORM, ["mm-code"])).toEqual({});
  });

  it("bounds tier to 1-4", () => {
    for (const defaultTier of ["", "0", "5", "1.5", "x"]) {
      expect(validateSettingsForm({ ...VALID_FORM, defaultTier }).defaultTier).toMatch(/tier/i);
    }
    expect(validateSettingsForm({ ...VALID_FORM, defaultTier: "4" })).toEqual({});
  });

  it("rejects an unknown agent but allows empty (auto) and skips the check without a known list", () => {
    expect(validateSettingsForm({ ...VALID_FORM, defaultAgent: "nope" }, ["mm-code"]).defaultAgent).toMatch(/agent/i);
    expect(validateSettingsForm({ ...VALID_FORM, defaultAgent: "" }, ["mm-code"])).toEqual({});
    expect(validateSettingsForm({ ...VALID_FORM, defaultAgent: "nope" }, [])).toEqual({});
  });

  it("bounds mode to stream|block|detached", () => {
    expect(validateSettingsForm({ ...VALID_FORM, runMode: "bogus" }).runMode).toMatch(/mode/i);
    for (const runMode of ["stream", "block", "detached"]) {
      expect(validateSettingsForm({ ...VALID_FORM, runMode })).toEqual({});
    }
  });

  it("bounds retries to an integer within 0-MAX_RETRIES", () => {
    for (const retries of ["-1", String(MAX_RETRIES + 1), "1.5", "abc"]) {
      expect(validateSettingsForm({ ...VALID_FORM, retries }).retries).toMatch(/retries/i);
    }
    expect(validateSettingsForm({ ...VALID_FORM, retries: String(MAX_RETRIES) })).toEqual({});
  });

  it("allows an empty SSE port and bounds it to 1-MAX_SSE_PORT", () => {
    expect(validateSettingsForm({ ...VALID_FORM, ssePort: "" })).toEqual({});
    expect(validateSettingsForm({ ...VALID_FORM, ssePort: String(MAX_SSE_PORT) })).toEqual({});
    for (const ssePort of ["0", String(MAX_SSE_PORT + 1), "1.5", "abc"]) {
      expect(validateSettingsForm({ ...VALID_FORM, ssePort }).ssePort).toMatch(/sse port/i);
    }
  });

  it("accepts any log dir and state dir (empty clears them)", () => {
    const errors = validateSettingsForm({ ...VALID_FORM, logDir: "relative path", stateDir: "/x" });
    expect(errors.logDir).toBeUndefined();
    expect(errors.stateDir).toBeUndefined();
  });
});

describe("settingsPatchFromForm", () => {
  it("coerces numeric fields and passes booleans/strings through", () => {
    const patch = settingsPatchFromForm({ ...VALID_FORM, defaultTier: "3", retries: "2", runMode: "block" });
    expect(patch).toMatchObject({
      defaultTier: 3,
      retries: 2,
      runMode: "block",
      autoRefresh: true,
      defaultAgent: "mm-code",
    });
  });

  it("clears advanced fields that are empty so the stored key is dropped", () => {
    const patch = settingsPatchFromForm(VALID_FORM);
    expect(patch).toMatchObject({
      ssePort: undefined,
      logDir: undefined,
      stateDir: undefined,
    });
  });

  it("trims and coerces filled advanced fields", () => {
    const patch = settingsPatchFromForm({
      ...VALID_FORM,
      ssePort: " 7800 ",
      logDir: " /tmp/logs ",
      stateDir: "/tmp/state",
    });
    expect(patch.ssePort).toBe(7800);
    expect(patch.logDir).toBe("/tmp/logs");
    expect(patch.stateDir).toBe("/tmp/state");
  });
});

describe("extraSettingsEntries", () => {
  it("returns unknown keys only, stringified, excluding editable keys", () => {
    const entries = extraSettingsEntries({
      ...DEFAULT_SETTINGS,
      ssePort: 7800,
      logDir: "/tmp/logs",
      configPath: "/home/u/.at/config.json",
      flags: { a: 1 },
    });
    expect(entries).toEqual([
      ["configPath", "/home/u/.at/config.json"],
      ["flags", '{"a":1}'],
    ]);
  });

  it("returns nothing when there are no extra keys", () => {
    expect(extraSettingsEntries(DEFAULT_SETTINGS)).toEqual([]);
  });
});
