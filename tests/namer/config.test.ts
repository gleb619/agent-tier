import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamerConfig, loadSecrets, resolveSecret } from "../../src/namer/config";
import { DEFAULT_NAMER_CONFIG } from "../../src/namer/default-config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "at-namer-cfg-"));
  delete process.env.AT_NAMER_CONFIG;
  delete process.env.AT_NAMER_SECRETS;
  delete process.env.OPENROUTER;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeAtJson(stateDir: string, name: string, body: unknown): string {
  const file = path.join(stateDir, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

describe("loadNamerConfig", () => {
  it("returns embedded default when namer.json is missing", async () => {
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(DEFAULT_NAMER_CONFIG.providers.length);
    expect(cfg.fallbackName).toBe(DEFAULT_NAMER_CONFIG.fallbackName);
  });

  it("parses a valid namer.json with multiple providers", async () => {
    writeAtJson(tmpDir, "namer.json", {
      providers: [
        { name: "a", type: "ollama", url: "http://x", model: "m1", timeoutMs: 1000 },
        { name: "b", type: "openrouter", url: "http://y", model: "m2", apiKeyRef: "openrouter", timeoutMs: 2000 },
      ],
      fallbackName: "unnamed",
    });
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(2);
    expect(cfg.providers[0]!.name).toBe("a");
    expect(cfg.providers[1]!.name).toBe("b");
    expect(cfg.fallbackName).toBe("unnamed");
  });

  it("ignores removed minLen / maxLen keys in namer.json", async () => {
    writeAtJson(tmpDir, "namer.json", {
      providers: [{ name: "a", type: "ollama", url: "http://x", model: "m1", timeoutMs: 1000 }],
      minLen: 20,
      maxLen: 40,
    });
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg).not.toHaveProperty("minLen");
    expect(cfg).not.toHaveProperty("maxLen");
  });

  it("drops a legacy ollama-ssh-tunnel provider as unknown type and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeAtJson(tmpDir, "namer.json", {
      providers: [
        {
          name: "b3",
          type: "ollama-ssh-tunnel",
          ssh: { host: "borispc3.ai", user: "boris", identityFile: "~/.ssh/id_rsa" },
          remoteUrl: "http://127.0.0.1:11434",
          model: "gemma3:1b",
          timeoutMs: 4000,
        },
        { name: "good", type: "ollama", url: "http://x", model: "m", timeoutMs: 1000 },
      ],
    });
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.name).toBe("good");
    expect(warnSpy).toHaveBeenCalledWith('[at] namer: dropping provider "b3" with unknown type "ollama-ssh-tunnel"');
    warnSpy.mockRestore();
  });

  it("falls back to the embedded default when only legacy ssh-tunnel providers are configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeAtJson(tmpDir, "namer.json", {
      providers: [
        {
          name: "b3",
          type: "ollama-ssh-tunnel",
          ssh: { host: "borispc3.ai", user: "boris" },
          remoteUrl: "http://127.0.0.1:11434",
          model: "gemma3:1b",
        },
      ],
      fallbackName: "legacy-fb",
    });
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toEqual(DEFAULT_NAMER_CONFIG.providers);
    expect(cfg.fallbackName).toBe("legacy-fb");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("drops invalid provider entries and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeAtJson(tmpDir, "namer.json", {
      providers: [
        { name: "good", type: "ollama", url: "http://x", model: "m", timeoutMs: 1000 },
        { name: "bad", /* missing type */ url: "http://y", model: "m", timeoutMs: 1000 },
        { name: "badtype", type: "unknown-thing", url: "http://z", model: "m", timeoutMs: 1000 },
      ],
    });
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]!.name).toBe("good");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to default and warns on parse error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(path.join(tmpDir, "namer.json"), "{ this is not json");
    const cfg = await loadNamerConfig(tmpDir);
    expect(cfg.providers).toHaveLength(DEFAULT_NAMER_CONFIG.providers.length);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("honours AT_NAMER_CONFIG override", async () => {
    const altDir = mkdtempSync(path.join(tmpdir(), "at-namer-cfg-alt-"));
    try {
      writeAtJson(altDir, "namer.json", {
        providers: [{ name: "overridden", type: "ollama", url: "http://override", model: "m", timeoutMs: 1000 }],
      });
      process.env.AT_NAMER_CONFIG = path.join(altDir, "namer.json");
      const cfg = await loadNamerConfig(tmpDir); // tmpDir is empty
      expect(cfg.providers).toHaveLength(1);
      expect(cfg.providers[0]!.name).toBe("overridden");
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});

describe("loadSecrets", () => {
  it("returns empty object when secrets.json is missing", async () => {
    const map = await loadSecrets(tmpDir);
    expect(map).toEqual({});
  });

  it("parses secrets.json with mode 0o600", async () => {
    const file = writeAtJson(tmpDir, "secrets.json", { openrouter: "sk-or-v1-abc" });
    chmodSync(file, 0o600);
    const map = await loadSecrets(tmpDir);
    expect(map.openrouter).toBe("sk-or-v1-abc");
  });

  it("refuses to read secrets.json with mode 0o644 (group/world writable)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = writeAtJson(tmpDir, "secrets.json", { openrouter: "should-not-be-read" });
    chmodSync(file, 0o644);
    const map = await loadSecrets(tmpDir);
    expect(map).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("honours AT_NAMER_SECRETS override", async () => {
    const altDir = mkdtempSync(path.join(tmpdir(), "at-namer-sec-alt-"));
    try {
      const file = writeAtJson(altDir, "secrets.json", { openrouter: "override-key" });
      chmodSync(file, 0o600);
      process.env.AT_NAMER_SECRETS = file;
      const map = await loadSecrets(tmpDir);
      expect(map.openrouter).toBe("override-key");
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });
});

describe("resolveSecret", () => {
  it("env wins over secrets map", () => {
    process.env.OPENROUTER = "env-key";
    const out = resolveSecret("openrouter", { openrouter: "secrets-key" });
    expect(out).toBe("env-key");
  });

  it("falls back to secrets map when env is unset", () => {
    delete process.env.OPENROUTER;
    const out = resolveSecret("openrouter", { openrouter: "secrets-key" });
    expect(out).toBe("secrets-key");
  });

  it("returns undefined when both env and secrets are missing", () => {
    delete process.env.OPENROUTER;
    const out = resolveSecret("openrouter", {});
    expect(out).toBeUndefined();
  });

  it("uppercases ref + replaces hyphens with underscores for env lookup", () => {
    process.env.MY_API = "env-value";
    const out = resolveSecret("my-api", {});
    expect(out).toBe("env-value");
  });
});
