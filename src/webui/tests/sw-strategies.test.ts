import { describe, expect, it } from "vitest";
import {
  cacheName,
  chooseStrategy,
  isApiPath,
  isEventStreamPath,
  isImmutableAsset,
  isNavigationRequest,
  isRunCreateRequest,
  isSameOrigin,
  isSwrApiPath,
  type SwStrategy,
} from "../utils/sw-strategies";

function req(method: string, url: string, mode: RequestMode = "no-cors"): Request {
  return new Request(url, { method, mode });
}

function navReq(): Request {
  return { method: "GET", mode: "navigate" } as unknown as Request;
}

describe("sw strategies", () => {
  const origin = self.location.origin;

  it("versions cache names", () => {
    expect(cacheName("precache")).toMatch(/^at-precache-v\d+$/);
  });

  it("detects same origin", () => {
    const scope = `${origin}/`;
    expect(isSameOrigin(new URL(`${origin}/foo`), scope)).toBe(true);
    expect(isSameOrigin(new URL("https://other.com/foo"), scope)).toBe(false);
  });

  it("detects immutable assets", () => {
    expect(isImmutableAsset(new URL("https://x.com/assets/index-aB3xYz99.js"))).toBe(true);
    expect(isImmutableAsset(new URL("https://x.com/assets/index-aB3xYz99.css"))).toBe(true);
    expect(isImmutableAsset(new URL("https://x.com/icon.png"))).toBe(false);
  });

  it("detects API paths", () => {
    expect(isApiPath(new URL("https://x.com/api/runs"))).toBe(true);
    expect(isApiPath(new URL("https://x.com/api/events"))).toBe(true);
    expect(isApiPath(new URL("https://x.com/"))).toBe(false);
  });

  it("detects SWR API paths", () => {
    expect(isSwrApiPath(new URL("https://x.com/api/runs"))).toBe(true);
    expect(isSwrApiPath(new URL("https://x.com/api/agents"))).toBe(true);
    expect(isSwrApiPath(new URL("https://x.com/api/stats"))).toBe(true);
    expect(isSwrApiPath(new URL("https://x.com/api/settings"))).toBe(false);
    expect(isSwrApiPath(new URL("https://x.com/api/runs/r1/log"))).toBe(true);
    expect(isSwrApiPath(new URL("https://x.com/api/events"))).toBe(false);
    expect(isSwrApiPath(new URL("https://x.com/api/runs/r1/discuss"))).toBe(true);
  });

  it("detects event stream paths", () => {
    expect(isEventStreamPath(new URL("https://x.com/api/events"))).toBe(true);
    expect(isEventStreamPath(new URL("https://x.com/api/events/r1"))).toBe(true);
    expect(isEventStreamPath(new URL("https://x.com/api/runs"))).toBe(false);
  });

  it("detects queueable run create requests", () => {
    expect(
      isRunCreateRequest(new Request("https://x.com/api/runs", { method: "POST" }), new URL("https://x.com/api/runs")),
    ).toBe(true);
    expect(
      isRunCreateRequest(new Request("https://x.com/api/runs", { method: "GET" }), new URL("https://x.com/api/runs")),
    ).toBe(false);
  });

  it("detects navigation requests", () => {
    expect(isNavigationRequest(navReq())).toBe(true);
    expect(isNavigationRequest(req("GET", `${origin}/api/runs`))).toBe(false);
  });

  it("chooses strategies", () => {
    const cases: [string, Request, SwStrategy][] = [
      [`${origin}/`, navReq(), "precache"],
      [`${origin}/assets/index-aB3xYz99.js`, req("GET", `${origin}/assets/index-aB3xYz99.js`), "cache-first"],
      [`${origin}/api/runs`, req("GET", `${origin}/api/runs`), "swr"],
      [`${origin}/api/events`, req("GET", `${origin}/api/events`), "network"],
      [`${origin}/api/runs`, req("POST", `${origin}/api/runs`), "offline-queue"],
      [`${origin}/icon.png`, req("GET", `${origin}/icon.png`), "precache"],
      ["https://other.com/api/runs", req("GET", "https://other.com/api/runs"), "network"],
    ];
    for (const [href, request, expected] of cases) {
      expect(chooseStrategy(request, new URL(href)), href).toBe(expected);
    }
  });
});
