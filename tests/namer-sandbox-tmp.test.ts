import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSessionName, loadNamerConfig, OllamaProvider, sanitizeName } from "../src/namer";
import { loadSecrets } from "../src/namer/config";

const TEST_PORT = 19878;
const STATE_DIR = "/tmp/at-namer-sandbox/final";
const LONG_NAME = "my-super-long-test-session-name";

describe("Namer /tmp sandbox integration (real mock HTTP)", () => {
  let server: http.Server;
  let tagsHit = 0;
  let genHit = 0;

  beforeAll(() => {
    mkdirSync(STATE_DIR, { recursive: true });
    server = http.createServer((req, res) => {
      if (req.url === "/api/tags" && req.method === "GET") {
        tagsHit++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "gemma3:1b" }] }));
        return;
      }
      if (req.url === "/api/generate" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          genHit++;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: "gemma3:1b",
              response: LONG_NAME,
              done: true,
            }),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    return new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("[tmp-sandbox] sanitizeName length bounds", () => {
    expect(sanitizeName("short")).toBeNull();
    expect(sanitizeName(LONG_NAME)).toBe(LONG_NAME);
    const long = sanitizeName("a-".repeat(100));
    expect(long).not.toBeNull();
    expect((long || "").length).toBeLessThanOrEqual(40);
  });

  it("[tmp-sandbox] OllamaProvider isAvailable + generate against real mock HTTP", async () => {
    const p = new OllamaProvider({
      url: `http://localhost:${TEST_PORT}`,
      model: "gemma3:1b",
      timeoutMs: 5000,
    });
    tagsHit = 0;
    genHit = 0;
    const ok = await p.isAvailable(new AbortController().signal);
    expect(ok).toBe(true);
    expect(tagsHit).toBe(1);
    const name = await p.generate("some coding task here", new AbortController().signal);
    expect(genHit).toBe(1);
    expect(name).toBe(LONG_NAME);
  });

  it("[tmp-sandbox] loadNamerConfig reads namer.json from /tmp state dir", async () => {
    const d = join(STATE_DIR, "cfg1");
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "namer.json"),
      JSON.stringify({
        providers: [
          {
            name: "sb1",
            type: "ollama",
            url: `http://localhost:${TEST_PORT}`,
            model: "gemma3:1b",
            timeoutMs: 2000,
          },
        ],
        fallbackName: "my-fb-name",
      }),
    );
    const cfg = await loadNamerConfig(d);
    expect(cfg.providers.length).toBe(1);
    expect(cfg.fallbackName).toBe("my-fb-name");
    expect((cfg.providers[0] as any).url).toBe(`http://localhost:${TEST_PORT}`);
  });

  it("[tmp-sandbox] loadSecrets enforces 0o600 permissions in /tmp", async () => {
    const d = join(STATE_DIR, "sec1");
    mkdirSync(d, { recursive: true });
    const f = join(d, "secrets.json");
    writeFileSync(f, JSON.stringify({ openrouter: "sk-test-123" }));

    chmodSync(f, 0o644);
    const bad = await loadSecrets(d);
    expect(Object.keys(bad).length).toBe(0);

    chmodSync(f, 0o600);
    const good = await loadSecrets(d);
    expect(good.openrouter).toBe("sk-test-123");
  });

  it("[tmp-sandbox] full orchestrator via config in /tmp", async () => {
    const d = join(STATE_DIR, "e2e");
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "namer.json"),
      JSON.stringify({
        providers: [
          {
            name: "my-provider",
            type: "ollama",
            url: `http://localhost:${TEST_PORT}`,
            model: "gemma3:1b",
            timeoutMs: 3000,
          },
        ],
        fallbackName: "e2e-fallback",
      }),
    );
    const result = await generateSessionName("Please refactor the auth module", d, {});
    expect(result.provider).toBe("my-provider");
    expect(result.name).toBe(LONG_NAME);
  });
});
