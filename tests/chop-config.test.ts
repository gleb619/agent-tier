import type { AtConfig } from "../src/config";
import { resolveNoChop } from "../src/config";

type Explicit = boolean | undefined;

describe("resolveNoChop", () => {
  // explicit: true  → user passed --no-chop (force off)
  // explicit: false → user passed --chop    (force on)
  // explicit: undef → no flag                (config decides)
  // config shape:
  //   null         → no config
  //   {}           → config present, chop key absent
  //   { chop: undefined } → explicit opt-out missing
  //   { chop: {} } → chop key present but enabled undefined
  //   { chop: { enabled: true } }  → user opted in via config (ignored — config can only opt out)
  //   { chop: { enabled: false } } → kill-switch ON
  const configs: Array<[string, AtConfig | null]> = [
    ["null", null],
    ["empty", {}],
    ["chop-undefined", { chop: undefined }],
    ["chop-empty-obj", { chop: {} }],
    ["chop-enabled-true", { chop: { enabled: true } }],
    ["chop-enabled-false", { chop: { enabled: false } }],
  ];

  const explicits: Array<[string, Explicit, boolean]> = [
    ["--no-chop", true, true], // explicit force off
    ["--chop", false, false], // explicit force on
    ["no flag", undefined, false], // falls back to config — all configs above default to chop on
  ];

  // Table-driven sweep — every (config, explicit) pair.
  for (const [configLabel, config] of configs) {
    for (const [explicitLabel, explicit, _expectedDefault] of explicits) {
      const expected = explicit === true ? true : explicit === false ? false : config?.chop?.enabled === false;

      it(`config=${configLabel} explicit=${explicitLabel} → ${expected}`, () => {
        expect(resolveNoChop(config, explicit)).toBe(expected);
      });
    }
  }

  // Targeted assertions to lock down the precedence rules in prose form.
  it("explicit --no-chop wins over config chop.enabled: false (still off)", () => {
    expect(resolveNoChop({ chop: { enabled: false } }, true)).toBe(true);
  });

  it("explicit --chop wins over config chop.enabled: false (forced on)", () => {
    expect(resolveNoChop({ chop: { enabled: false } }, false)).toBe(false);
  });

  it("explicit --no-chop wins over config chop.enabled: true (still off)", () => {
    expect(resolveNoChop({ chop: { enabled: true } }, true)).toBe(true);
  });

  it("explicit --chop wins over config chop.enabled: true (still on)", () => {
    expect(resolveNoChop({ chop: { enabled: true } }, false)).toBe(false);
  });

  it("no flag + config chop.enabled: false → chop off (kill-switch path)", () => {
    expect(resolveNoChop({ chop: { enabled: false } }, undefined)).toBe(true);
  });

  it("no flag + config chop.enabled: true → chop on (config cannot opt in)", () => {
    expect(resolveNoChop({ chop: { enabled: true } }, undefined)).toBe(false);
  });

  it("no flag + config absent → chop on (current default behavior preserved)", () => {
    expect(resolveNoChop(null, undefined)).toBe(false);
    expect(resolveNoChop({}, undefined)).toBe(false);
    expect(resolveNoChop({ chop: {} }, undefined)).toBe(false);
  });

  it("no flag + null config (file missing / unsigned / tampered) → chop on", () => {
    expect(resolveNoChop(null, undefined)).toBe(false);
  });

  it("ignores unrelated config keys (jsonDefaults, sandbox) — only chop matters", () => {
    expect(
      resolveNoChop(
        { sandbox: { enabled: true }, jsonDefaults: { foo: 1 }, globalPrompt: "x", line: ["mock"] },
        undefined,
      ),
    ).toBe(false);
  });
});
