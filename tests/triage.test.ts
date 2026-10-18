import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askTev1,
  breakerDownUntil,
  heuristicSignals,
  heuristicTriage,
  loadTriageConfig,
  refineSignals,
  resolveModelConfig,
  resolveTriageProviders,
  triage,
  triageConfigPath,
} from "../src/triage";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "triage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sysOne = (p: number) =>
  json({
    answers: Object.fromEntries(
      ["crossModule", "needsPlan", "iterative", "risky", "backlog"].map((k) => [k, { noul: p }]),
    ),
  });

describe("heuristic", () => {
  it("plain fix → single, tier 2, no signals", () => {
    const r = heuristicTriage("Fix the off-by-one in formatDate() in src/utils/format.ts");
    expect(r).toMatchObject({ route: "single", tier: 2, signals: [], source: "heuristic" });
  });
  it("one signal stays single", () => {
    expect(heuristicTriage("migrate the users table").route).toBe("single");
  });
  it("two signals → plan-then-do candidate, risky → tier 1", () => {
    const r = heuristicTriage("Design and migrate the auth schema, iterate until tests pass");
    expect(r.route).toBe("plan-then-do");
    expect(r.tier).toBe(1);
    expect(r.signals).toEqual(expect.arrayContaining(["needsPlan", "risky", "iterative"]));
  });
  it("≥6 distinct files → crossModule", () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/m${i}/a.ts`).join(" ");
    expect(heuristicSignals(`touch ${files}`)).toContain("crossModule");
    expect(heuristicSignals("touch src/a/b.ts src/c/d.ts")).not.toContain("crossModule");
  });
  it("long prompt alone is not a signal", () => {
    expect(heuristicSignals("add a log line. ".repeat(500))).toEqual([]);
  });
});

describe("refineSignals", () => {
  it("vetoes heuristic hits the model strongly disagrees with; never adds model-only signals", () => {
    expect(
      refineSignals(["risky", "needsPlan"], { risky: 0.1, needsPlan: 0.6, backlog: 0.99, iterative: 0.9 }),
    ).toEqual(["needsPlan"]);
    expect(refineSignals(["risky"], {})).toEqual(["risky"]);
  });
});

describe("askTev1 providers", () => {
  it("local-ollama: posts /v1/systemone to localhost", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const r = await askTev1("p", {
      stateDir: dir,
      fetchImpl: (async (u: string, init: RequestInit) => {
        url = u;
        body = JSON.parse(init.body as string);
        return sysOne(0.9);
      }) as typeof fetch,
    });
    expect(url).toBe("http://localhost:11434/v1/systemone");
    expect(body.model).toBe("tev1:0.8b");
    expect(Object.keys(body.questions as object)).toHaveLength(5);
    expect(r).toMatchObject({ ok: true });
  });

  it("remote-ollama: custom url + bearer", async () => {
    let url = "";
    let auth = "";
    await askTev1("p", {
      provider: "remote-ollama",
      url: "http://gpu-box:11434/",
      apiKey: "k",
      stateDir: dir,
      fetchImpl: (async (u: string, init: RequestInit) => {
        url = u;
        auth = (init.headers as Record<string, string>).Authorization;
        return sysOne(0.5);
      }) as typeof fetch,
    });
    expect(url).toBe("http://gpu-box:11434/v1/systemone");
    expect(auth).toBe("Bearer k");
  });

  it("openrouter: chat completions, parses JSON probabilities", async () => {
    let url = "";
    const r = await askTev1("p", {
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1",
      apiKey: "sk",
      stateDir: dir,
      fetchImpl: (async (u: string) => {
        url = u;
        return json({ choices: [{ message: { content: 'ok {"risky":0.9,"backlog":0.1,"x":5}' } }] });
      }) as typeof fetch,
    });
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r).toEqual({ ok: true, probs: { risky: 0.9, backlog: 0.1 } });
  });

  it("hung server → timeout, breaker opens, next call skips fetch", async () => {
    let calls = 0;
    const hang = ((_u: string, init: RequestInit) => {
      calls++;
      return new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    }) as typeof fetch;
    const t0 = Date.now();
    const warmed: unknown[] = [];
    const r1 = await askTev1("p", {
      stateDir: dir,
      timeoutMs: 50,
      ttlMs: 60_000,
      fetchImpl: hang,
      warm: (t) => warmed.push(t),
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r1).toEqual({ ok: false, reason: "model unavailable: timeout" });
    expect(breakerDownUntil(dir)).toBeGreaterThan(Date.now());
    expect(warmed).toEqual([{ url: "http://localhost:11434", model: "tev1:0.8b", apiKey: undefined }]);
    const r2 = await askTev1("p", { stateDir: dir, timeoutMs: 50, fetchImpl: hang });
    expect(calls).toBe(1);
    expect(r2.ok).toBe(false);
  });

  it("breaker expires after ttl and success closes it", async () => {
    let now = 1_000;
    const fail = (async () => json({}, 500)) as unknown as typeof fetch;
    await askTev1("p", { stateDir: dir, ttlMs: 100, now: () => now, fetchImpl: fail });
    expect(breakerDownUntil(dir)).toBe(1_100);
    now = 2_000;
    const r = await askTev1("p", { stateDir: dir, now: () => now, fetchImpl: (async () => sysOne(1)) as typeof fetch });
    expect(r.ok).toBe(true);
    expect(breakerDownUntil(dir)).toBe(0);
  });

  it("connection refused / bad JSON / empty answers → ok:false, never throws", async () => {
    for (const f of [
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => new Response("not json", { status: 200 }),
      async () => json({ answers: {} }),
    ]) {
      const r = await askTev1("p", { stateDir: dir, now: () => 5, fetchImpl: f as unknown as typeof fetch });
      expect(r.ok).toBe(false);
      rmSync(path.join(dir, "triage-tev1.json"), { force: true });
    }
  });
});

describe("triage()", () => {
  const ok = (p: number) => (async () => sysOne(p)) as unknown as typeof fetch;
  const refused = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const RISKY = "Design and migrate the auth schema";

  it("no models → heuristic only", async () => {
    expect((await triage("fix typo")).source).toBe("heuristic");
  });
  it("no heuristic hit → model never called", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return sysOne(1);
    }) as unknown as typeof fetch;
    const r = await triage("fix typo in src/a.ts", { models: [{ stateDir: dir, fetchImpl }] });
    expect(called).toBe(false);
    expect(r.route).toBe("single");
  });
  it("model refines: strong disagreement downgrades to single; source names the provider", async () => {
    const r = await triage(RISKY, { models: [{ name: "box", stateDir: dir, fetchImpl: ok(0.05) }] });
    expect(r).toMatchObject({ route: "single", source: "heuristic+box", signals: [] });
  });
  it("all models down → heuristic verdict + notes", async () => {
    const r = await triage(RISKY, { models: [{ name: "a", stateDir: dir, fetchImpl: refused }] });
    expect(r.route).toBe("plan-then-do");
    expect(r.source).toBe("heuristic");
    expect(r.note).toContain("ECONNREFUSED");
  });
  it("falls through to the next provider; breaker is per provider", async () => {
    const r = await triage(RISKY, {
      models: [
        { name: "remote", stateDir: dir, fetchImpl: refused },
        { name: "local", stateDir: dir, fetchImpl: ok(0.9) },
      ],
    });
    expect(r.source).toBe("heuristic+local");
    expect(r.note).toContain("remote unavailable");
    expect(breakerDownUntil(dir, "remote")).toBeGreaterThan(Date.now());
    expect(breakerDownUntil(dir, "local")).toBe(0);
  });
});

describe("resolveModelConfig", () => {
  it("off by default; legacy AT_TRIAGE_TEV1 → local-ollama", () => {
    expect(resolveModelConfig({}, dir)).toBeNull();
    expect(resolveModelConfig({ AT_TRIAGE_TEV1: "1" }, dir)).toMatchObject({
      opts: { provider: "local-ollama", url: "http://localhost:11434" },
    });
  });
  it("remote-ollama requires AT_TRIAGE_URL", () => {
    expect(resolveModelConfig({ AT_TRIAGE_PROVIDER: "remote-ollama" }, dir)).toEqual({
      error: "remote-ollama needs AT_TRIAGE_URL",
    });
    expect(
      resolveModelConfig(
        { AT_TRIAGE_PROVIDER: "remote-ollama", AT_TRIAGE_URL: "http://h:1", AT_TRIAGE_API_KEY: "k" },
        dir,
      ),
    ).toMatchObject({ opts: { url: "http://h:1", apiKey: "k" } });
  });
  it("openrouter requires a key; falls back to OPENROUTER_API_KEY", () => {
    expect(resolveModelConfig({ AT_TRIAGE_PROVIDER: "openrouter" }, dir)).toHaveProperty("error");
    expect(resolveModelConfig({ AT_TRIAGE_PROVIDER: "openrouter", OPENROUTER_API_KEY: "or" }, dir)).toMatchObject({
      opts: { provider: "openrouter", apiKey: "or", url: "https://openrouter.ai/api/v1" },
    });
  });
  it("flag overrides env; unknown provider errors; timeout/ttl/model from env", () => {
    expect(resolveModelConfig({ AT_TRIAGE_PROVIDER: "openrouter" }, dir, "local-ollama")).toMatchObject({
      opts: { provider: "local-ollama" },
    });
    expect(resolveModelConfig({}, dir, "bogus")).toHaveProperty("error");
    expect(
      resolveModelConfig(
        {
          AT_TRIAGE_PROVIDER: "local-ollama",
          AT_TRIAGE_TIMEOUT_MS: "300",
          AT_TRIAGE_TTL_MS: "9",
          AT_TRIAGE_MODEL: "m",
        },
        dir,
      ),
    ).toMatchObject({ opts: { timeoutMs: 300, ttlMs: 9, model: "m" } });
  });
});

it("breaker file is valid JSON", async () => {
  await askTev1("p", {
    stateDir: dir,
    now: () => 1,
    fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch,
  });
  expect(JSON.parse(readFileSync(path.join(dir, "triage-tev1.json"), "utf8")).downUntil).toBeGreaterThan(1);
});

describe("timeout vs hard failure breaker", () => {
  const hang = ((_u: string, init: RequestInit) =>
    new Promise((_res, rej) =>
      init.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
    )) as typeof fetch;

  it("timeout → short breaker + warm-up; hard error → full ttl, no warm-up; openrouter never warms", async () => {
    let warms = 0;
    const warm = () => {
      warms++;
    };
    await askTev1("p", { stateDir: dir, timeoutMs: 20, ttlMs: 300_000, now: () => 0, fetchImpl: hang, warm });
    expect(breakerDownUntil(dir)).toBe(30_000);
    expect(warms).toBe(1);
    rmSync(path.join(dir, "triage-tev1.json"));

    await askTev1("p", {
      stateDir: dir,
      ttlMs: 300_000,
      now: () => 0,
      warm,
      fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch,
    });
    expect(breakerDownUntil(dir)).toBe(300_000);
    expect(warms).toBe(1);
    rmSync(path.join(dir, "triage-tev1.json"));

    await askTev1("p", {
      provider: "openrouter",
      apiKey: "k",
      stateDir: dir,
      timeoutMs: 20,
      now: () => 0,
      fetchImpl: hang,
      warm,
    });
    expect(warms).toBe(1);
  });
});

describe("triage.json", () => {
  const write = (body: unknown) => {
    const f = path.join(dir, "triage.json");
    writeFileSync(f, JSON.stringify(body));
    return f;
  };
  const CATALOG = {
    use: ["borispc3", "local-ollama"],
    providers: [
      { name: "local-ollama", type: "ollama", url: "http://localhost:11434", model: "tev1:0.8b" },
      { name: "borispc3", type: "ollama", url: "http://borispc3.ai:7869", model: "tev1:latest", timeoutMs: 4000 },
      { name: "or", type: "openrouter", url: "https://openrouter.ai/api/v1", apiKeyRef: "or-key" },
      { name: "bad", type: "grpc", url: "x" },
      { name: "nourl", type: "ollama" },
    ],
  };

  it("missing/corrupt file → empty, no throw", () => {
    expect(loadTriageConfig(dir, {})).toEqual({ use: [], providers: [] });
    writeFileSync(path.join(dir, "triage.json"), "{nope");
    expect(loadTriageConfig(dir, {})).toEqual({ use: [], providers: [] });
  });

  it("validates providers, drops bad ones, accepts use as string or list", () => {
    write(CATALOG);
    const cfg = loadTriageConfig(dir, {});
    expect(cfg.providers.map((p) => p.name)).toEqual(["local-ollama", "borispc3", "or"]);
    expect(cfg.use).toEqual(["borispc3", "local-ollama"]);
    write({ use: "a, b", providers: [] });
    expect(loadTriageConfig(dir, {}).use).toEqual(["a", "b"]);
  });

  it("AT_TRIAGE_CONFIG overrides the path", () => {
    const f = write(CATALOG);
    expect(triageConfigPath("/nowhere", { AT_TRIAGE_CONFIG: f })).toBe(f);
  });

  it("resolves `use` in order with per-provider url/model/timeout", async () => {
    write(CATALOG);
    const r = await resolveTriageProviders(dir, undefined, {});
    expect(r.errors).toEqual([]);
    expect(r.models.map((m) => [m.name, m.url, m.model, m.timeoutMs])).toEqual([
      ["borispc3", "http://borispc3.ai:7869", "tev1:latest", 4000],
      ["local-ollama", "http://localhost:11434", "tev1:0.8b", 3000],
    ]);
  });

  it("flag and env override `use`; empty use → heuristic only", async () => {
    write(CATALOG);
    expect((await resolveTriageProviders(dir, "local-ollama", {})).models.map((m) => m.name)).toEqual(["local-ollama"]);
    expect(
      (await resolveTriageProviders(dir, undefined, { AT_TRIAGE_PROVIDER: "borispc3" })).models.map((m) => m.name),
    ).toEqual(["borispc3"]);
    write({ providers: CATALOG.providers });
    expect((await resolveTriageProviders(dir, undefined, {})).models).toEqual([]);
  });

  it("openrouter key from env via apiKeyRef; missing key / unknown name → errors, not throws", async () => {
    write(CATALOG);
    const none = await resolveTriageProviders(dir, "or,ghost", {});
    expect(none.models).toEqual([]);
    expect(none.errors).toHaveLength(2);
    const prev = process.env.OR_KEY;
    process.env.OR_KEY = "sk-1";
    try {
      const ok = await resolveTriageProviders(dir, "or", {});
      expect(ok.models[0]).toMatchObject({ provider: "openrouter", apiKey: "sk-1" });
    } finally {
      if (prev === undefined) delete process.env.OR_KEY;
      else process.env.OR_KEY = prev;
    }
  });

  it("falls back to env presets for names missing from the file", async () => {
    const r = await resolveTriageProviders(dir, "local-ollama", { AT_TRIAGE_URL: "http://h:1" });
    expect(r.models[0]).toMatchObject({ name: "local-ollama", url: "http://h:1" });
  });
});
