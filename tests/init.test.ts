import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInit, formatInitResults, getTemplateAgentNames, getTemplate, InitOptions } from '../src/init';

// We test with real filesystem for a realistic integration test,
// but use temp directories to isolate.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-init-test-'));
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Helper: create a minimal agent-like bin path inside tmpDir
function binPath(name: string): string {
  return path.join(tmpDir, name);
}

// Override HOME and *_BIN so agents resolve under tmpDir
function withEnv(overrides: Record<string, string>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  // Reset module cache so registry re-evaluates with new env
  jest.resetModules();
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    jest.resetModules();
  }
}

describe('getTemplateAgentNames', () => {
  it('returns array of agent names with templates', () => {
    const names = getTemplateAgentNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('glm-code');
  });

  it('all returned names have a valid template', () => {
    for (const name of getTemplateAgentNames()) {
      expect(getTemplate(name)).toBeDefined();
      expect(getTemplate(name)!.agentName).toBe(name);
    }
  });
});

describe('getTemplate', () => {
  it('returns template for glm-code', () => {
    const t = getTemplate('glm-code');
    expect(t).toBeDefined();
    expect(t!.agentName).toBe('glm-code');
    expect(typeof t!.content).toBe('string');
    expect(t!.content.length).toBeGreaterThan(100);
    // Should be a valid bash script
    expect(t!.content).toContain('#!/bin/bash');
    expect(t!.content).toContain('claude "$@"');
  });

  it('returns undefined for unknown agent', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });
});

describe('runInit - list mode', () => {
  it('lists all template agents with status', () => {
    const results = runInit({ list: true });
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.agent).toBeTruthy();
      expect(r.targetPath).toBeTruthy();
      expect(['skipped', 'would_create']).toContain(r.action);
    }
  });

  it('shows "skipped" for agents whose binary already exists', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      // Create the file first
      fs.mkdirSync(path.dirname(binPath('glm-code')), { recursive: true });
      fs.writeFileSync(binPath('glm-code'), '#!/bin/bash\necho ok', { mode: 0o755 });

      const results = runInit({ list: true });
      const glm = results.find((r) => r.agent === 'glm-code');
      expect(glm).toBeDefined();
      expect(glm!.action).toBe('skipped');
      expect(glm!.reason).toContain('already exists');
    });
  });
});

describe('runInit - create single agent', () => {
  it('creates wrapper script when target does not exist', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      const results = runInit({ agent: 'glm-code' });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('created');
      expect(results[0].agent).toBe('glm-code');
      expect(results[0].targetPath).toBe(binPath('glm-code'));

      // Verify file was actually written
      expect(fs.existsSync(binPath('glm-code'))).toBe(true);
      const content = fs.readFileSync(binPath('glm-code'), 'utf8');
      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('claude "$@"');

      // Verify executable permissions
      const stat = fs.statSync(binPath('glm-code'));
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o111).not.toBe(0);
    });
  });

  it('skips when target already exists', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      // Pre-create the file
      fs.mkdirSync(path.dirname(binPath('glm-code')), { recursive: true });
      fs.writeFileSync(binPath('glm-code'), 'existing content', { mode: 0o755 });

      const results = runInit({ agent: 'glm-code' });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(results[0].reason).toContain('already exists');

      // Content should NOT be overwritten
      expect(fs.readFileSync(binPath('glm-code'), 'utf8')).toBe('existing content');
    });
  });

  it('overwrites with --force', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      // Pre-create the file
      fs.mkdirSync(path.dirname(binPath('glm-code')), { recursive: true });
      fs.writeFileSync(binPath('glm-code'), 'existing content', { mode: 0o755 });

      const results = runInit({ agent: 'glm-code', force: true });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('created');

      // Content should be overwritten with template
      expect(fs.readFileSync(binPath('glm-code'), 'utf8')).toContain('claude "$@"');
    });
  });

  it('dry run does not write file', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      const results = runInit({ agent: 'glm-code', dryRun: true });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('would_create');
      expect(results[0].targetPath).toBe(binPath('glm-code'));

      // File should NOT have been written
      expect(fs.existsSync(binPath('glm-code'))).toBe(false);
    });
  });

  it('dry run shows would_create even if file already exists', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      // Pre-create the file
      fs.mkdirSync(path.dirname(binPath('glm-code')), { recursive: true });
      fs.writeFileSync(binPath('glm-code'), 'existing', { mode: 0o755 });

      // Dry run with force shows would_create
      const results = runInit({ agent: 'glm-code', dryRun: true, force: true });
      expect(results[0].action).toBe('would_create');
    });
  });

  it('creates parent directories if missing', () => {
    const deepPath = path.join(tmpDir, 'deep', 'nested', 'glm-code');
    withEnv({ GLM_CODE_BIN: deepPath }, () => {
      const results = runInit({ agent: 'glm-code' });
      expect(results[0].action).toBe('created');
      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  it('throws for agent with no template', () => {
    expect(() => runInit({ agent: 'blackbox' })).toThrow('No template defined');
  });

  it('throws when no agent or flags provided', () => {
    expect(() => runInit({})).toThrow('Specify an agent name');
  });
});

describe('runInit - all mode', () => {
  it('creates all missing wrapper scripts', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      const results = runInit({ all: true });

      const created = results.filter((r) => r.action === 'created');
      expect(created.length).toBeGreaterThan(0);

      const glm = results.find((r) => r.agent === 'glm-code');
      expect(glm).toBeDefined();
      expect(glm!.action).toBe('created');
    });
  });

  it('skips existing and creates missing', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      // Pre-create glm-code
      fs.mkdirSync(path.dirname(binPath('glm-code')), { recursive: true });
      fs.writeFileSync(binPath('glm-code'), 'existing', { mode: 0o755 });

      const results = runInit({ all: true });
      const glm = results.find((r) => r.agent === 'glm-code');
      expect(glm!.action).toBe('skipped');
    });
  });

  it('dry run does not write any files', () => {
    withEnv({ GLM_CODE_BIN: binPath('glm-code') }, () => {
      const results = runInit({ all: true, dryRun: true });

      for (const r of results) {
        expect(r.action).toBe('would_create');
        expect(fs.existsSync(r.targetPath)).toBe(false);
      }
    });
  });
});

describe('formatInitResults', () => {
  it('formats created result', () => {
    const output = formatInitResults([
      { agent: 'glm-code', targetPath: '/usr/local/bin/glm-code', action: 'created' },
    ]);
    expect(output).toContain('CREATED');
    expect(output).toContain('glm-code');
    expect(output).toContain('/usr/local/bin/glm-code');
  });

  it('formats skipped result with reason', () => {
    const output = formatInitResults([
      {
        agent: 'glm-code',
        targetPath: '/usr/local/bin/glm-code',
        action: 'skipped',
        reason: 'already exists (use --force to overwrite)',
      },
    ]);
    expect(output).toContain('SKIP');
    expect(output).toContain('already exists');
  });

  it('formats would_create result', () => {
    const output = formatInitResults([
      { agent: 'glm-code', targetPath: '/usr/local/bin/glm-code', action: 'would_create' },
    ]);
    expect(output).toContain('WOULD CREATE');
  });

  it('formats multiple results on separate lines', () => {
    const output = formatInitResults([
      { agent: 'glm-code', targetPath: '/tmp/a', action: 'created' },
      { agent: 'other', targetPath: '/tmp/b', action: 'skipped', reason: 'exists' },
    ]);
    const lines = output.split('\n');
    expect(lines).toHaveLength(2);
  });
});

describe('template content integrity', () => {
  it('glm-code template has required elements', () => {
    const t = getTemplate('glm-code')!;
    // Shebang
    expect(t.content).toContain('#!/bin/bash');
    // set flags for safety
    expect(t.content).toContain('set -euo pipefail');
    // Config isolation
    expect(t.content).toContain('CLAUDE_CONFIG_DIR');
    expect(t.content).toContain('.config/glm-code');
    // API endpoint
    expect(t.content).toContain('ANTHROPIC_BASE_URL');
    expect(t.content).toContain('api.z.ai');
    // Key retrieval
    expect(t.content).toContain('keyring get glm-code');
    // Pass-through
    expect(t.content).toContain('claude "$@"');
    // Error handling for missing key
    expect(t.content).toContain('ERROR');
    expect(t.content).toContain('exit 1');
  });
});
