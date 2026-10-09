import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  addFeedback,
  listFeedback,
  getFeedback,
  updateFeedback,
  appendFeedbackLog,
  removeFeedback,
  clearFeedback,
  pruneFeedback,
  getFeedbackFile,
  FeedbackEntry,
} from '../src/feedback-store';

function makeStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'at-feedback-test-'));
}

function writeFeedbackFile(stateDir: string, entries: FeedbackEntry[]): void {
  const file = getFeedbackFile(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  const content = entries.length
    ? entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(file, content, 'utf8');
}

function findById(stateDir: string, id: string): FeedbackEntry | undefined {
  return listFeedback(stateDir, { limit: 1000 }).find((e) => e.id === id);
}

describe('feedback-store', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = makeStateDir();
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    delete process.env.AT_FEEDBACK_MAX_ENTRIES;
    delete process.env.AT_FEEDBACK_MAX_BYTES;
    delete process.env.AT_FEEDBACK_RESOLVED_TTL_MS;
    delete process.env.AT_FEEDBACK_LOG_TTL_MS;
  });

  describe('addFeedback / listFeedback / getFeedback', () => {
    it('adds and reads back a note', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'hello world' });
      expect(entry.text).toBe('hello world');
      expect(entry.kind).toBe('note');
      expect(entry.status).toBe('open');
      expect(entry.id).toHaveLength(8);
      expect(entry.atVersion).toBeDefined();

      const found = getFeedback(stateDir, entry.id);
      expect(found?.id).toBe(entry.id);

      const all = listFeedback(stateDir);
      expect(all).toHaveLength(1);
      expect(all[0].text).toBe('hello world');
    });

    it('adds a bug with agent/tags/context', async () => {
      const { entry } = await addFeedback(stateDir, {
        text: 'crash on start',
        kind: 'bug',
        agent: 'opencode',
        runId: 'run-1',
        tier: 2,
        tags: ['crash', 'ui'],
        context: 'exit code 1',
        cwd: '/tmp',
      });
      expect(entry.kind).toBe('bug');
      expect(entry.agent).toBe('opencode');
      expect(entry.tags).toEqual(['crash', 'ui']);
      expect(entry.context).toBe('exit code 1');
      expect(entry.cwd).toBe('/tmp');
    });

    it('lists newest first with default limit 20', async () => {
      for (let i = 0; i < 25; i++) {
        await addFeedback(stateDir, { text: `item ${i}` });
      }
      const all = listFeedback(stateDir);
      expect(all).toHaveLength(20);
      expect(all[0].text).toBe('item 24');
      expect(all[19].text).toBe('item 5');
    });

    it('filters by status, kind, agent, and tag', async () => {
      await addFeedback(stateDir, {
        text: 'a',
        kind: 'bug',
        agent: 'opencode',
        tags: ['x'],
      });
      await addFeedback(stateDir, {
        text: 'b',
        kind: 'improvement',
        agent: 'kimi',
        tags: ['y'],
      });
      const { entry: note } = await addFeedback(stateDir, {
        text: 'c',
        kind: 'note',
        agent: 'opencode',
        tags: ['x'],
      });
      await updateFeedback(stateDir, note.id, { status: 'resolved' });

      expect(listFeedback(stateDir, { kind: 'bug' })).toHaveLength(1);
      expect(listFeedback(stateDir, { agent: 'opencode' })).toHaveLength(2);
      expect(listFeedback(stateDir, { tag: 'y' })[0].text).toBe('b');
      expect(listFeedback(stateDir, { status: 'resolved' })[0].text).toBe('c');
    });

    it('resolves an entry by unique prefix', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'prefix me' });
      const prefix = entry.id.slice(0, 4);
      const resolved = await updateFeedback(stateDir, prefix, {
        status: 'resolved',
      });
      expect(resolved.id).toBe(entry.id);
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedAt).toBeDefined();
    });

    it('throws when id prefix is ambiguous', async () => {
      writeFeedbackFile(stateDir, [
        { id: 'abc11111', kind: 'note', text: 'one', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'abc22222', kind: 'note', text: 'two', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);
      expect(() => getFeedback(stateDir, 'abc')).toThrow('ambiguous');
    });

    it('throws when entry not found', async () => {
      expect(() => getFeedback(stateDir, '00000000')).toThrow('not found');
    });
  });

  describe('updateFeedback', () => {
    it('updates text, kind, agent, and tags', async () => {
      const { entry } = await addFeedback(stateDir, {
        text: 'orig',
        kind: 'note',
        tags: ['old'],
      });
      const updated = await updateFeedback(stateDir, entry.id, {
        text: 'new text',
        kind: 'improvement',
        agent: 'kimi',
        tags: ['new', 'tag'],
      });
      expect(updated.text).toBe('new text');
      expect(updated.kind).toBe('improvement');
      expect(updated.agent).toBe('kimi');
      expect(updated.tags).toEqual(['new', 'tag']);
    });

    it('clears resolvedAt when reopened', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      await updateFeedback(stateDir, entry.id, { status: 'resolved' });
      let found = getFeedback(stateDir, entry.id)!;
      expect(found.resolvedAt).toBeDefined();

      await updateFeedback(stateDir, entry.id, { status: 'open' });
      found = getFeedback(stateDir, entry.id)!;
      expect(found.status).toBe('open');
      expect(found.resolvedAt).toBeUndefined();
    });

    it('rejects empty or oversized text', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'ok' });
      await expect(
        updateFeedback(stateDir, entry.id, { text: '' })
      ).rejects.toThrow('cannot be empty');
      await expect(
        updateFeedback(stateDir, entry.id, { text: 'x'.repeat(4001) })
      ).rejects.toThrow('exceeds 4000');
    });
  });

  describe('removeFeedback / clearFeedback / pruneFeedback', () => {
    it('removes entries by id', async () => {
      const { entry: a } = await addFeedback(stateDir, { text: 'a' });
      const { entry: b } = await addFeedback(stateDir, { text: 'b' });
      const removed = await removeFeedback(stateDir, [a.id]);
      expect(removed).toBe(1);
      expect(findById(stateDir, a.id)).toBeUndefined();
      expect(findById(stateDir, b.id)).toBeDefined();
    });

    it('clears resolved entries only with --resolved', async () => {
      const { entry: a } = await addFeedback(stateDir, { text: 'a' });
      const { entry: b } = await addFeedback(stateDir, { text: 'b' });
      await updateFeedback(stateDir, a.id, { status: 'resolved' });
      const removed = await clearFeedback(stateDir, { resolved: true });
      expect(removed).toBe(1);
      expect(listFeedback(stateDir)).toHaveLength(1);
      expect(listFeedback(stateDir)[0].text).toBe('b');
    });

    it('requires --yes for --all', async () => {
      await addFeedback(stateDir, { text: 'a' });
      await expect(clearFeedback(stateDir, { all: true })).rejects.toThrow(
        '--yes is required'
      );
    });

    it('clears all with --yes', async () => {
      await addFeedback(stateDir, { text: 'a' });
      await addFeedback(stateDir, { text: 'b' });
      const removed = await clearFeedback(stateDir, { all: true, yes: true });
      expect(removed).toBe(2);
      expect(listFeedback(stateDir)).toHaveLength(0);
    });

    it('prunes old resolved entries by ttl', async () => {
      const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      writeFeedbackFile(stateDir, [
        { id: 'oldres', kind: 'note', text: 'stale', status: 'resolved', createdAt: old, updatedAt: old, resolvedAt: old },
        { id: 'fresh', kind: 'note', text: 'fresh', status: 'open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);
      const evicted = await pruneFeedback(stateDir);
      expect(evicted).toBe(1);
      expect(listFeedback(stateDir).map((e) => e.id)).toEqual(['fresh']);
    });
  });

  describe('corrupt line tolerance', () => {
    it('skips corrupt jsonl lines', () => {
      const file = getFeedbackFile(stateDir);
      fs.writeFileSync(
        file,
        '{"id":"good1","kind":"note","text":"ok","status":"open","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}\nthis is not json\n{"id":"good2","kind":"note","text":"ok2","status":"open","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}\n',
        'utf8'
      );
      const entries = listFeedback(stateDir);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.id).sort()).toEqual(['good1', 'good2']);
    });
  });

  describe('eviction policy', () => {
    it('evicts oldest resolved/wontfix, then notes, then remaining', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxEntries: 2 } }),
        'utf8'
      );
      const t0 = new Date(Date.now() - 3000).toISOString();
      const t1 = new Date(Date.now() - 2000).toISOString();
      const t2 = new Date(Date.now() - 1000).toISOString();
      writeFeedbackFile(stateDir, [
        { id: 'resolvedold', kind: 'bug', text: 'r', status: 'resolved', createdAt: t0, updatedAt: t0, resolvedAt: t0 },
        { id: 'noteold', kind: 'note', text: 'n', status: 'open', createdAt: t1, updatedAt: t1 },
        { id: 'bugold', kind: 'bug', text: 'b', status: 'open', createdAt: t2, updatedAt: t2 },
      ]);

      const { entry: newest, evicted } = await addFeedback(stateDir, { text: 'newest', kind: 'bug' });
      expect(evicted).toBe(2);
      const ids = listFeedback(stateDir, { limit: 10 }).map((e) => e.id);
      expect(ids).toContain('bugold');
      expect(ids).toContain(newest.id);
      expect(ids).not.toContain('resolvedold');
      expect(ids).not.toContain('noteold');
    });

    it('evicts by byte cap', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxBytes: 350 } }),
        'utf8'
      );
      for (let i = 0; i < 10; i++) {
        await addFeedback(stateDir, { text: `entry ${i} ${'x'.repeat(50)}` });
      }
      const entries = listFeedback(stateDir, { limit: 100 });
      expect(entries.length).toBeLessThan(10);
      expect(entries[0].text.startsWith('entry 9')).toBe(true);
    });

    it('rejects an entry that alone exceeds maxBytes', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxBytes: 50 } }),
        'utf8'
      );
      await expect(
        addFeedback(stateDir, { text: 'this text is way too long to fit' })
      ).rejects.toThrow('exceeds maximum byte size');
    });

    it('warns when autoclean evicts on add', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxEntries: 1 } }),
        'utf8'
      );
      await addFeedback(stateDir, { text: 'first' });
      const { evicted } = await addFeedback(stateDir, { text: 'second' });
      expect(evicted).toBe(1);
      const all = listFeedback(stateDir, { limit: 10 });
      expect(all).toHaveLength(1);
      expect(all[0].text).toBe('second');
    });
  });

  describe('appendFeedbackLog', () => {
    it('appends items in order and survives reload', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      await appendFeedbackLog(stateDir, entry.id, {
        note: 'start', state: 'EXECUTE', subState: 'DELEGATE', outcome: 'try', runId: 'r1',
      });
      await appendFeedbackLog(stateDir, entry.id.slice(0, 4), {
        note: 'tsc failed', outcome: 'failed', files: ['src/a.ts'],
      });
      const got = getFeedback(stateDir, entry.id)!;
      expect(got.log).toHaveLength(2);
      expect(got.log![0]).toMatchObject({ state: 'EXECUTE', subState: 'DELEGATE', outcome: 'try', runId: 'r1' });
      expect(got.log![1]).toMatchObject({ outcome: 'failed', files: ['src/a.ts'] });
    });

    it('drops items older than log TTL on write', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
      writeFeedbackFile(stateDir, [
        { ...entry, log: [{ at: old, outcome: 'failed', note: 'stale' }] },
      ]);
      await appendFeedbackLog(stateDir, entry.id, { note: 'fresh', outcome: 'try' });
      const got = getFeedback(stateDir, entry.id)!;
      expect(got.log!.map((i) => i.note)).toEqual(['fresh']);
    });

    it('prune removes expired log and respects AT_FEEDBACK_LOG_TTL_MS', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      const old = new Date(Date.now() - 5000).toISOString();
      writeFeedbackFile(stateDir, [
        { ...entry, log: [{ at: old, outcome: 'failed', note: 'a' }] },
      ]);
      process.env.AT_FEEDBACK_LOG_TTL_MS = '1000';
      await pruneFeedback(stateDir);
      // pruneFeedback only rewrites on eviction; trigger a write
      await appendFeedbackLog(stateDir, entry.id, { note: 'b' });
      expect(getFeedback(stateDir, entry.id)!.log!.map((i) => i.note)).toEqual(['b']);
    });

    it('caps items per entry', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      for (let i = 0; i < 55; i++) {
        await appendFeedbackLog(stateDir, entry.id, { note: `n${i}` });
      }
      const log = getFeedback(stateDir, entry.id)!.log!;
      expect(log).toHaveLength(50);
      expect(log[49].note).toBe('n54');
    });

    it('rejects empty note and unknown id', async () => {
      const { entry } = await addFeedback(stateDir, { text: 'x' });
      await expect(appendFeedbackLog(stateDir, entry.id, { note: ' ' })).rejects.toThrow();
      await expect(appendFeedbackLog(stateDir, 'zzzz', { note: 'a' })).rejects.toThrow('not found');
    });
  });

  describe('config overrides', () => {
    it('reads limits from state.json', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxEntries: 2 } }),
        'utf8'
      );
      for (let i = 0; i < 5; i++) {
        await addFeedback(stateDir, { text: `s${i}` });
      }
      expect(listFeedback(stateDir, { limit: 100 })).toHaveLength(2);
    });

    it('env variables override state.json', async () => {
      fs.writeFileSync(
        path.join(stateDir, 'state.json'),
        JSON.stringify({ feedback: { maxEntries: 100 } }),
        'utf8'
      );
      process.env.AT_FEEDBACK_MAX_ENTRIES = '3';
      for (let i = 0; i < 5; i++) {
        await addFeedback(stateDir, { text: `e${i}` });
      }
      expect(listFeedback(stateDir, { limit: 100 })).toHaveLength(3);
    });

    it('invalid env values fall back to defaults', async () => {
      process.env.AT_FEEDBACK_MAX_ENTRIES = 'not-a-number';
      for (let i = 0; i < 5; i++) {
        await addFeedback(stateDir, { text: `d${i}` });
      }
      expect(listFeedback(stateDir, { limit: 100 })).toHaveLength(5);
    });
  });

  describe('concurrent adds', () => {
    it('handles Promise.all(20) without losing entries', async () => {
      await Promise.all(
        Array.from({ length: 20 }).map((_, i) => addFeedback(stateDir, { text: `concurrent ${i}` }))
      );
      const entries = listFeedback(stateDir, { limit: 100 });
      expect(entries).toHaveLength(20);
      expect(new Set(entries.map((e) => e.id)).size).toBe(20);
    });
  });

  describe('validation', () => {
    it('rejects empty text', async () => {
      await expect(addFeedback(stateDir, { text: '' })).rejects.toThrow(
        'cannot be empty'
      );
      await expect(addFeedback(stateDir, { text: '   ' })).rejects.toThrow(
        'cannot be empty'
      );
    });

    it('rejects text over 4000 chars', async () => {
      await expect(
        addFeedback(stateDir, { text: 'x'.repeat(4001) })
      ).rejects.toThrow('exceeds 4000');
    });
  });
});
