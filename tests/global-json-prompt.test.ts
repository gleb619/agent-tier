import { describe, expect, it } from "vitest";
import type { AtConfig } from "../src/config";
import { mergeJsonDefaults } from "../src/resolver";

describe("mergeJsonDefaults", () => {
  it("returns stdin when no defaults", () => {
    expect(mergeJsonDefaults({ prompt: "hi" }, undefined)).toEqual({ prompt: "hi" });
  });

  it("applies defaults when stdin is empty", () => {
    expect(mergeJsonDefaults({}, { agent: "mm-code", cwd: "/tmp" })).toEqual({ agent: "mm-code", cwd: "/tmp" });
  });

  it("stdin overrides defaults for scalar fields", () => {
    expect(
      mergeJsonDefaults({ agent: "opencode", cwd: "/proj" }, { agent: "mm-code", cwd: "/tmp", model: "gpt-4" }),
    ).toEqual({ agent: "opencode", cwd: "/proj", model: "gpt-4" });
  });

  it("merges env objects (defaults + stdin, stdin wins on key collision)", () => {
    expect(
      mergeJsonDefaults({ env: { FOO: "bar", SHARED: "from-stdin" } }, { env: { FOO: "baz", OTHER: "from-default" } }),
    ).toEqual({ env: { FOO: "bar", SHARED: "from-stdin", OTHER: "from-default" } });
  });

  it("keeps stdin env when defaults env is not an object", () => {
    expect(mergeJsonDefaults({ env: { FOO: "bar" } }, { env: "not-an-object" as unknown })).toEqual({
      env: { FOO: "bar" },
    });
  });
});

describe("AtConfig.jsonDefaults", () => {
  it("accepts a jsonDefaults field in config shape", () => {
    const cfg: AtConfig = {
      jsonDefaults: { agent: "mm-code", cwd: "/tmp", env: { NODE_ENV: "test" } },
    };
    expect(cfg.jsonDefaults?.agent).toBe("mm-code");
    expect(cfg.jsonDefaults?.env).toEqual({ NODE_ENV: "test" });
  });
});
