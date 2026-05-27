import { formatStatusTable, formatStatusJson, formatStateReport, buildStateReport, AgentHealthEntry } from '../src/status';
import { RunRecord } from '../src/run-store';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const baseRun: RunRecord = {
  runId: 'r3k2a1b9',
  agent: 'opencode',
  tier: 2,
  pid: 28451,
  prompt: 'fix the bug',
  logFile: '/tmp/at-logs/at-test-opencode.log',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  status: 'running',
};

describe('formatStatusTable', () => {
  it('shows "no runs found" for empty array', () => {
    expect(formatStatusTable([])).toBe('[at] no runs found');
  });

  it('formats a table with header and rows', () => {
    const result = formatStatusTable([baseRun]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('RUN');
    expect(lines[0]).toContain('AGENT');
    expect(lines[0]).toContain('STATUS');
    expect(lines[0]).toContain('DURATION');
    expect(lines[0]).toContain('LOG');
    expect(lines[1]).toContain('r3k2a1');
    expect(lines[1]).toContain('opencode');
    expect(lines[1]).toContain('running');
    expect(lines[1]).toContain('/tmp/at-logs/at-test-opencode.log');
  });

  it('formats multiple runs', () => {
    const done: RunRecord = {
      ...baseRun,
      runId: 'f7c4d2e1',
      agent: 'blackbox',
      status: 'done',
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    };
    const result = formatStatusTable([baseRun, done]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('running');
    expect(lines[2]).toContain('done');
  });
});

describe('formatStatusJson', () => {
  it('returns valid JSON', () => {
    const result = formatStatusJson([baseRun]);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('total matches runs.length', () => {
    const result = JSON.parse(formatStatusJson([baseRun, { ...baseRun, runId: 'x', status: 'done' }]));
    expect(result.total).toBe(2);
    expect(result.runs).toHaveLength(2);
  });

  it('runId not truncated', () => {
    const longRunId = 'r3k2a1b9-static-long-id-for-test';
    const run = { ...baseRun, runId: longRunId };
    const result = JSON.parse(formatStatusJson([run]));
    expect(result.runs[0].runId).toBe(longRunId);
  });

  it('agent not truncated', () => {
    const result = JSON.parse(formatStatusJson([baseRun]));
    expect(result.runs[0].agent).toBe('opencode');
  });

  it('logFile not truncated', () => {
    const result = JSON.parse(formatStatusJson([baseRun]));
    expect(result.runs[0].logFile).toBe('/tmp/at-logs/at-test-opencode.log');
  });
});

// --- State report with agent health ---

const tmpDir = path.join(os.tmpdir(), 'at-status-test-' + process.pid);

function writeTestStateFile(agentlyHealth: Record<string, unknown>) {
  mkdirSync(tmpDir, { recursive: true });
  const state = {
    agents: agentlyHealth,
    scheduler: { default: { index: 1 } },
    runs: { maxEntries: 50 },
  };
  writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify(state, null, 2));
}

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildStateReport', () => {
  it('includes agents array in report', () => {
    writeTestStateFile({
      opencode: { failureTimes: [], disabledTo: null, deactivated: true },
      gemini: { failureTimes: ['2026-05-23T09:25:00.000Z'], disabledTo: null },
      blackbox: { failureTimes: [], disabledTo: null },
    });

    const report = buildStateReport(tmpDir);
    expect(report.agents.length).toBeGreaterThanOrEqual(3);
    expect(report.maxEntries).toBe(50);
    expect(report.scheduler[0]?.key).toBe('default');
  });

  it('marks deactivated agents', () => {
    writeTestStateFile({
      opencode: { failureTimes: [], disabledTo: null, deactivated: true },
    });

    const report = buildStateReport(tmpDir);
    const oc = report.agents.find((a) => a.name === 'opencode');
    expect(oc).toBeDefined();
    expect(oc!.deactivated).toBe(true);
    expect(oc!.failures).toBe(0);
  });

  it('counts failures and tracks lastFailure', () => {
    writeTestStateFile({
      qwen: {
        failureTimes: ['2026-05-23T09:25:00.000Z', '2026-05-23T09:45:00.000Z'],
        disabledTo: null,
      },
    });

    const report = buildStateReport(tmpDir);
    const qwen = report.agents.find((a) => a.name === 'qwen');
    expect(qwen).toBeDefined();
    expect(qwen!.failures).toBe(2);
    expect(qwen!.lastFailure).toBe('2026-05-23T09:45:00.000Z');
  });

  it('surfaces disabledTo when set', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeTestStateFile({
      gemini: { failureTimes: ['2026-05-23T09:25:00.000Z'], disabledTo: future },
    });

    const report = buildStateReport(tmpDir);
    const gem = report.agents.find((a) => a.name === 'gemini');
    expect(gem).toBeDefined();
    expect(gem!.disabledTo).toBe(future);
  });

  it('returns empty agents when no health data', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ scheduler: {} }));

    const report = buildStateReport(tmpDir);
    expect(report.agents).toEqual([]);
  });
});

describe('formatStateReport', () => {
  it('shows DEACTIVATED label', () => {
    writeTestStateFile({
      goose: { failureTimes: [], disabledTo: null, deactivated: true },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain('DEACTIVATED');
    expect(out).toContain('goose');
  });

  it('shows failure count and relative time', () => {
    writeTestStateFile({
      qwen: {
        failureTimes: ['2026-05-23T09:25:00.000Z', '2026-05-23T09:45:00.000Z'],
        disabledTo: null,
      },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain('2 failures');
    expect(out).toContain('last:');
    expect(out).toContain('ago');
  });

  it('shows "ok" for healthy agents', () => {
    writeTestStateFile({
      blackbox: { failureTimes: [], disabledTo: null },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain('blackbox: ok');
  });

  it('shows disabled-until with relative time', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeTestStateFile({
      gemini: { failureTimes: [], disabledTo: future },
    });

    const out = formatStateReport(tmpDir);
    expect(out).toContain('disabled until');
    expect(out).toContain('from now');
  });
});
