/**
 * Threshold gate for Lighthouse results (see web-lighthouse.ts).
 * Pure functions only — kept separate so the pass/fail logic is unit-testable
 * without launching a browser.
 */

export interface LighthouseGateConfig {
  /** Minimum category score (0..1), e.g. { "performance": 0.9 }. */
  categories?: Record<string, number>;
  /** Minimum audit score (0..1). Binary audits: 1 = must pass. */
  audits?: Record<string, number>;
}

export interface GateCheck {
  id: string;
  kind: "category" | "audit";
  score: number;
  min: number;
}

export interface GateResult {
  ok: boolean;
  checks: GateCheck[];
  failures: string[];
}

/** Minimal shape of the Lighthouse result (LHR) JSON we depend on. */
export interface LhrLike {
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<string, { score: number | null } | undefined>;
}

export function evaluateGate(lhr: LhrLike, config: LighthouseGateConfig): GateResult {
  const checks: GateCheck[] = [];
  const failures: string[] = [];

  for (const [id, min] of Object.entries(config.categories ?? {})) {
    const category = lhr.categories[id];
    const score = category?.score ?? null;
    if (score === null) {
      failures.push(`category "${id}": missing from report`);
      continue;
    }
    checks.push({ id, kind: "category", score, min });
    if (score < min) failures.push(`category "${id}": score ${score.toFixed(2)} < ${min.toFixed(2)}`);
  }

  for (const [id, min] of Object.entries(config.audits ?? {})) {
    const audit = lhr.audits[id];
    const score = audit?.score ?? null;
    if (score === null) {
      failures.push(`audit "${id}": missing from report`);
      continue;
    }
    checks.push({ id, kind: "audit", score, min });
    if (score < min) failures.push(`audit "${id}": score ${score.toFixed(2)} < ${min.toFixed(2)}`);
  }

  return { ok: failures.length === 0, checks, failures };
}

export function formatGateResult(result: GateResult): string {
  const lines = result.checks.map(
    (c) => `  ${c.kind.padEnd(8)} ${c.id.padEnd(24)} ${c.score.toFixed(2)} (min ${c.min.toFixed(2)})`,
  );
  if (result.failures.length > 0) lines.push("failures:", ...result.failures.map((f) => `  - ${f}`));
  return lines.join("\n");
}
