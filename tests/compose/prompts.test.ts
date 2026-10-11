import { describe, expect, it } from "vitest";
import { buildCheckPrompt, buildImplementPrompt, buildPlanPrompt } from "../../src/compose/prompts";

const DIR = "/tmp/at-compose/goal-1";
const PLAN = "# Plan\n\n## Tasks\n\n- [ ] 1. Add resolver\n- [ ] 2. Add tests\n";

describe("buildPlanPrompt", () => {
  const base = { goal: "add retry to resolver", context: "src/resolver.ts: pick()", workspaceDir: DIR };

  it("carries goal and codegraph context", () => {
    const p = buildPlanPrompt(base);
    expect(p).toContain("add retry to resolver");
    expect(p).toContain("src/resolver.ts: pick()");
  });

  it("asks for plan.md with requirements, design and a numbered checklist", () => {
    const p = buildPlanPrompt(base);
    expect(p).toContain(`${DIR}/plan.md`);
    expect(p).toContain("Requirements");
    expect(p).toContain("Design");
    expect(p).toContain("- [ ] 1.");
  });

  it("has no findings section on the first plan", () => {
    expect(buildPlanPrompt(base)).not.toMatch(/previous verdict/i);
  });

  it("includes previous verdict findings on re-plan", () => {
    const p = buildPlanPrompt({ ...base, findings: "FAIL\n\n- resolver swallows ECONNRESET\n" });
    expect(p).toContain("resolver swallows ECONNRESET");
    expect(p).toMatch(/previous verdict/i);
  });

  it("says re-plan is append-only new unchecked tasks", () => {
    const p = buildPlanPrompt({ ...base, findings: "FAIL\n" });
    expect(p).toMatch(/append/i);
    expect(p).toMatch(/unchecked/i);
    expect(p).toMatch(/- \[ \]/);
  });

  it("survives empty context", () => {
    expect(buildPlanPrompt({ ...base, context: "" })).toContain("add retry to resolver");
  });
});

describe("buildImplementPrompt", () => {
  it("carries the goal, the single task and the plan", () => {
    const p = buildImplementPrompt({ goal: "add retry", task: "2. Add tests", plan: PLAN, workspaceDir: DIR });
    expect(p).toContain("add retry");
    expect(p).toContain("2. Add tests");
    expect(p).toContain("Add resolver");
    expect(p).toContain(`${DIR}/plan.md`);
  });

  it("forbids the implementer from ticking the checklist itself", () => {
    const p = buildImplementPrompt({
      goal: "add retry",
      task: "1. Add resolver",
      plan: PLAN,
      workspaceDir: DIR,
    });
    expect(p).toMatch(/do not (edit|tick|modify)/i);
  });

  it("tells the implementer to ask the host via discuss instead of guessing", () => {
    const p = buildImplementPrompt({ goal: "add retry", task: "1. Add resolver", plan: PLAN, workspaceDir: DIR });
    expect(p).toContain("$AT_BIN discuss ask");
    expect(p).toMatch(/do not guess/i);
  });
});

describe("buildCheckPrompt", () => {
  const base = {
    goal: "add retry to resolver",
    plan: PLAN,
    testCmd: "npm test",
    testExitCode: 1,
    testOutput: "FAIL tests/resolver.test.ts > retries",
    diff: "diff --git a/src/resolver.ts b/src/resolver.ts\n+retry()",
    workspaceDir: DIR,
  };

  it("includes plan, git diff and test output", () => {
    const p = buildCheckPrompt(base);
    expect(p).toContain("Add resolver");
    expect(p).toContain("+retry()");
    expect(p).toContain("FAIL tests/resolver.test.ts > retries");
  });

  it("names the test command and its exit code", () => {
    const p = buildCheckPrompt(base);
    expect(p).toContain("npm test");
    expect(p).toContain("exit code: 1");
  });

  it("requires verdict.md whose first line is PASS or FAIL", () => {
    const p = buildCheckPrompt(base);
    expect(p).toContain(`${DIR}/verdict.md`);
    expect(p).toMatch(/first line/i);
    expect(p).toContain("PASS");
    expect(p).toContain("FAIL");
  });

  it("reports a zero exit code as-is", () => {
    expect(buildCheckPrompt({ ...base, testExitCode: 0 })).toContain("exit code: 0");
  });

  it("forbids PASS when the test exit code is not zero", () => {
    const p = buildCheckPrompt(base);
    expect(p).toMatch(/cannot be PASS/i);
  });
});
