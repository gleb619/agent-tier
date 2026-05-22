import { formatStatusTable } from '../src/status';
import { RunRecord } from '../src/run-store';

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
