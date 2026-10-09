import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'fs';
import path from 'path';
import crypto from 'crypto';
import { withLock } from './lock';
import { getStateFilePath } from './state-dir';

export type FeedbackKind = 'bug' | 'improvement' | 'note';
export type FeedbackStatus = 'open' | 'resolved' | 'wontfix';

export interface FeedbackEntry {
  id: string;
  kind: FeedbackKind;
  text: string;
  agent?: string;
  runId?: string;
  tier?: number;
  status: FeedbackStatus;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  cwd?: string;
  atVersion?: string;
  context?: string;
  log?: FeedbackLogItem[];
}

export type FeedbackLogOutcome = 'try' | 'ok' | 'failed' | 'info';

export interface FeedbackLogItem {
  at: string;
  state?: string;
  subState?: string;
  outcome: FeedbackLogOutcome;
  note: string;
  runId?: string;
  files?: string[];
}

export interface FeedbackLogInput {
  note: string;
  state?: string;
  subState?: string;
  outcome?: FeedbackLogOutcome;
  runId?: string;
  files?: string[];
}

export interface FeedbackAddInput {
  text: string;
  kind?: FeedbackKind;
  agent?: string;
  runId?: string;
  tier?: number;
  tags?: string[];
  context?: string;
  cwd?: string;
}

export interface FeedbackUpdateInput {
  text?: string;
  kind?: FeedbackKind;
  status?: FeedbackStatus;
  agent?: string;
  tags?: string[];
}

export interface FeedbackFilter {
  status?: FeedbackStatus;
  kind?: FeedbackKind;
  agent?: string;
  tag?: string;
  limit?: number;
}

export interface FeedbackConfig {
  maxEntries: number;
  maxBytes: number;
  resolvedTtlMs: number;
  logTtlMs: number;
  maxLogItems: number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_ITEMS = 50;

export function getFeedbackFile(stateDir: string): string {
  return path.join(stateDir, 'feedback.jsonl');
}

function getAtVersion(): string | undefined {
  let dir = __dirname;
  const root = path.parse(dir).root;
  while (dir !== root) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, 'package.json'), 'utf8')
      ) as { version?: string };
      if (pkg.version) {
        return pkg.version;
      }
    } catch {
      // keep walking
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

function readConfig(stateDir: string): FeedbackConfig {
  const parseNumber = (
    raw: string | undefined,
    fallback: number
  ): number => {
    if (raw === undefined) {
      return Number.NaN;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.max(1, Math.floor(n));
    }
    return Number.NaN;
  };

  const cfg: FeedbackConfig = {
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxBytes: DEFAULT_MAX_BYTES,
    resolvedTtlMs: DEFAULT_RESOLVED_TTL_MS,
    logTtlMs: DEFAULT_LOG_TTL_MS,
    maxLogItems: DEFAULT_MAX_LOG_ITEMS,
  };

  // log settings are independent of the eviction settings below
  const envLogTtl = parseNumber(process.env.AT_FEEDBACK_LOG_TTL_MS, DEFAULT_LOG_TTL_MS);
  if (!Number.isNaN(envLogTtl)) {
    cfg.logTtlMs = envLogTtl;
  } else {
    try {
      const data = JSON.parse(
        readFileSync(getStateFilePath(stateDir), 'utf8')
      ) as { feedback?: Partial<FeedbackConfig> };
      const n = Number(data.feedback?.logTtlMs);
      if (Number.isFinite(n) && n >= 1) {
        cfg.logTtlMs = Math.floor(n);
      }
    } catch {
      // ignore missing or malformed state.json
    }
  }

  const envEntries = parseNumber(process.env.AT_FEEDBACK_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
  const envBytes = parseNumber(process.env.AT_FEEDBACK_MAX_BYTES, DEFAULT_MAX_BYTES);
  const envTtl = parseNumber(process.env.AT_FEEDBACK_RESOLVED_TTL_MS, DEFAULT_RESOLVED_TTL_MS);

  let useEnv = false;
  if (process.env.AT_FEEDBACK_MAX_ENTRIES !== undefined) {
    if (!Number.isNaN(envEntries)) {
      cfg.maxEntries = envEntries;
      useEnv = true;
    }
  }
  if (process.env.AT_FEEDBACK_MAX_BYTES !== undefined) {
    if (!Number.isNaN(envBytes)) {
      cfg.maxBytes = envBytes;
      useEnv = true;
    }
  }
  if (process.env.AT_FEEDBACK_RESOLVED_TTL_MS !== undefined) {
    if (!Number.isNaN(envTtl)) {
      cfg.resolvedTtlMs = envTtl;
      useEnv = true;
    }
  }

  if (!useEnv) {
    try {
      const data = JSON.parse(
        readFileSync(getStateFilePath(stateDir), 'utf8')
      ) as { feedback?: Partial<FeedbackConfig> };
      if (data.feedback) {
        if (data.feedback.maxEntries !== undefined) {
          const n = Number(data.feedback.maxEntries);
          if (Number.isFinite(n)) {
            cfg.maxEntries = Math.max(1, Math.floor(n));
          }
        }
        if (data.feedback.maxBytes !== undefined) {
          const n = Number(data.feedback.maxBytes);
          if (Number.isFinite(n)) {
            cfg.maxBytes = Math.max(1, Math.floor(n));
          }
        }
        if (data.feedback.resolvedTtlMs !== undefined) {
          const n = Number(data.feedback.resolvedTtlMs);
          if (Number.isFinite(n)) {
            cfg.resolvedTtlMs = Math.max(1, Math.floor(n));
          }
        }
      }
    } catch {
      // ignore missing or malformed state.json
    }
  }

  return cfg;
}

function readJsonl(filePath: string): FeedbackEntry[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries: FeedbackEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as FeedbackEntry);
    } catch {
      // skip corrupt lines
    }
  }
  return entries;
}

function jsonlByteSize(entries: FeedbackEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return Buffer.byteLength(content, 'utf8');
}

function writeJsonlAtomic(filePath: string, entries: FeedbackEntry[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const content = entries.length
    ? entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    : '';
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

function findEntryIndex(
  entries: FeedbackEntry[],
  idOrPrefix: string
): number {
  const exact = entries.findIndex((e) => e.id === idOrPrefix);
  if (exact >= 0) {
    return exact;
  }
  const matches: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].id.startsWith(idOrPrefix)) {
      matches.push(i);
    }
  }
  if (matches.length === 0) {
    throw new Error(`feedback not found: ${idOrPrefix}`);
  }
  if (matches.length > 1) {
    throw new Error(`ambiguous feedback id: ${idOrPrefix}`);
  }
  return matches[0];
}

function findEvictionIndex(
  entries: FeedbackEntry[],
  protectId?: string
): number {
  const isProtected = (id: string): boolean =>
    protectId !== undefined && id === protectId;

  // 1. oldest resolved/wontfix by createdAt
  let idx = -1;
  let oldest = Infinity;
  for (let i = 0; i < entries.length; i++) {
    if (isProtected(entries[i].id)) {
      continue;
    }
    if (entries[i].status === 'resolved' || entries[i].status === 'wontfix') {
      const t = new Date(entries[i].createdAt).getTime();
      if (t < oldest) {
        oldest = t;
        idx = i;
      }
    }
  }
  if (idx >= 0) {
    return idx;
  }

  // 2. oldest note by createdAt
  idx = -1;
  oldest = Infinity;
  for (let i = 0; i < entries.length; i++) {
    if (isProtected(entries[i].id)) {
      continue;
    }
    if (entries[i].kind === 'note') {
      const t = new Date(entries[i].createdAt).getTime();
      if (t < oldest) {
        oldest = t;
        idx = i;
      }
    }
  }
  if (idx >= 0) {
    return idx;
  }

  // 3. oldest remaining by createdAt
  idx = -1;
  oldest = Infinity;
  for (let i = 0; i < entries.length; i++) {
    if (isProtected(entries[i].id)) {
      continue;
    }
    const t = new Date(entries[i].createdAt).getTime();
    if (t < oldest) {
      oldest = t;
      idx = i;
    }
  }
  return idx;
}

interface PruneResult {
  entries: FeedbackEntry[];
  evicted: number;
  protectedKept: boolean;
}

function pruneLog(
  entry: FeedbackEntry,
  cfg: FeedbackConfig,
  nowMs: number
): FeedbackEntry {
  if (!entry.log) {
    return entry;
  }
  const kept = entry.log
    .filter((item) => nowMs - new Date(item.at).getTime() <= cfg.logTtlMs)
    .slice(-cfg.maxLogItems);
  if (kept.length === entry.log.length) {
    return entry;
  }
  const next = { ...entry };
  if (kept.length > 0) {
    next.log = kept;
  } else {
    delete next.log;
  }
  return next;
}

function pruneEntries(
  entries: FeedbackEntry[],
  cfg: FeedbackConfig,
  protectId?: string
): PruneResult {
  const nowMs = Date.now();
  let evicted = 0;

  let result = entries.filter((e) => {
    if (
      (e.status === 'resolved' || e.status === 'wontfix') &&
      e.resolvedAt
    ) {
      const resolvedMs = new Date(e.resolvedAt).getTime();
      if (nowMs - resolvedMs > cfg.resolvedTtlMs) {
        evicted++;
        return false;
      }
    }
    return true;
  });

  result = result.map((e) => pruneLog(e, cfg, nowMs));

  let protectedKept = true;

  while (result.length > cfg.maxEntries || jsonlByteSize(result) > cfg.maxBytes) {
    const idx = findEvictionIndex(result, protectId);
    if (idx < 0) {
      // only protected entry remains and it alone exceeds limits
      protectedKept = false;
      break;
    }
    result.splice(idx, 1);
    evicted++;
  }

  return { entries: result, evicted, protectedKept };
}

function validateText(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new Error('feedback text cannot be empty');
  }
  if (text.length > 4000) {
    throw new Error('feedback text exceeds 4000 characters');
  }
}

export async function addFeedback(
  stateDir: string,
  input: FeedbackAddInput
): Promise<{ entry: FeedbackEntry; evicted: number }> {
  validateText(input.text);

  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, async () => {
    const cfg = readConfig(stateDir);
    let entries = readJsonl(filePath);

    const now = new Date().toISOString();
    const entry: FeedbackEntry = {
      id: crypto.randomBytes(4).toString('hex'),
      kind: input.kind ?? 'note',
      text: input.text,
      agent: input.agent,
      runId: input.runId,
      tier: input.tier,
      status: 'open',
      tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
      createdAt: now,
      updatedAt: now,
      cwd: input.cwd,
      atVersion: getAtVersion(),
      context: input.context,
    };

    while (entries.some((e) => e.id === entry.id)) {
      entry.id = crypto.randomBytes(4).toString('hex');
    }

    const singleSize = Buffer.byteLength(JSON.stringify(entry) + '\n', 'utf8');
    if (singleSize > cfg.maxBytes) {
      throw new Error('feedback entry exceeds maximum byte size');
    }

    entries.unshift(entry);
    const pruned = pruneEntries(entries, cfg, entry.id);
    if (!pruned.protectedKept) {
      throw new Error('feedback entry exceeds maximum byte size');
    }

    writeJsonlAtomic(filePath, pruned.entries);
    return { entry, evicted: pruned.evicted };
  });
}

export function listFeedback(
  stateDir: string,
  filter: FeedbackFilter = {}
): FeedbackEntry[] {
  let entries = readJsonl(getFeedbackFile(stateDir));

  if (filter.status) {
    entries = entries.filter((e) => e.status === filter.status);
  }
  if (filter.kind) {
    entries = entries.filter((e) => e.kind === filter.kind);
  }
  if (filter.agent) {
    entries = entries.filter((e) => e.agent === filter.agent);
  }
  if (filter.tag) {
    entries = entries.filter((e) => e.tags?.includes(filter.tag as string));
  }

  entries.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const limit = filter.limit ?? 20;
  return entries.slice(0, limit);
}

export function getFeedback(
  stateDir: string,
  idOrPrefix: string
): FeedbackEntry | undefined {
  const entries = readJsonl(getFeedbackFile(stateDir));
  const idx = findEntryIndex(entries, idOrPrefix);
  return entries[idx];
}

export async function updateFeedback(
  stateDir: string,
  idOrPrefix: string,
  input: FeedbackUpdateInput
): Promise<FeedbackEntry> {
  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, () => {
    const entries = readJsonl(filePath);
    const idx = findEntryIndex(entries, idOrPrefix);
    const entry = entries[idx];

    if (input.text !== undefined) {
      validateText(input.text);
      entry.text = input.text;
    }
    if (input.kind !== undefined) {
      entry.kind = input.kind;
    }
    if (input.status !== undefined) {
      entry.status = input.status;
      if (
        (input.status === 'resolved' || input.status === 'wontfix') &&
        !entry.resolvedAt
      ) {
        entry.resolvedAt = new Date().toISOString();
      }
      if (input.status === 'open') {
        delete entry.resolvedAt;
      }
    }
    if (input.agent !== undefined) {
      entry.agent = input.agent;
    }
    if (input.tags !== undefined) {
      entry.tags = input.tags.length > 0 ? input.tags : undefined;
    }

    entry.updatedAt = new Date().toISOString();
    writeJsonlAtomic(filePath, entries);
    return entry;
  });
}

export async function appendFeedbackLog(
  stateDir: string,
  idOrPrefix: string,
  input: FeedbackLogInput
): Promise<FeedbackEntry> {
  validateText(input.note);
  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, () => {
    const cfg = readConfig(stateDir);
    const entries = readJsonl(filePath);
    const idx = findEntryIndex(entries, idOrPrefix);
    const now = new Date();

    const item: FeedbackLogItem = {
      at: now.toISOString(),
      state: input.state,
      subState: input.subState,
      outcome: input.outcome ?? 'info',
      note: input.note,
      runId: input.runId,
      files: input.files && input.files.length > 0 ? input.files : undefined,
    };

    const entry = entries[idx];
    entry.log = [...(entry.log ?? []), item];
    entry.updatedAt = item.at;
    entries[idx] = pruneLog(entry, cfg, now.getTime());

    writeJsonlAtomic(filePath, entries);
    return entries[idx];
  });
}

export async function removeFeedback(
  stateDir: string,
  ids: string[]
): Promise<number> {
  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, () => {
    let entries = readJsonl(filePath);
    let removed = 0;

    for (const id of ids) {
      const idx = findEntryIndex(entries, id);
      entries.splice(idx, 1);
      removed++;
    }

    writeJsonlAtomic(filePath, entries);
    return removed;
  });
}

export async function clearFeedback(
  stateDir: string,
  opts: { resolved?: boolean; all?: boolean; yes?: boolean }
): Promise<number> {
  if (opts.all && !opts.yes) {
    throw new Error('--yes is required to clear all feedback');
  }

  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, () => {
    const entries = readJsonl(filePath);
    let toKeep: FeedbackEntry[];
    let removed: number;

    if (opts.all) {
      removed = entries.length;
      toKeep = [];
    } else if (opts.resolved) {
      toKeep = entries.filter(
        (e) => e.status !== 'resolved' && e.status !== 'wontfix'
      );
      removed = entries.length - toKeep.length;
    } else {
      throw new Error('specify --resolved or --all');
    }

    writeJsonlAtomic(filePath, toKeep);
    return removed;
  });
}

export async function pruneFeedback(stateDir: string): Promise<number> {
  const filePath = getFeedbackFile(stateDir);
  return withLock(filePath, () => {
    const cfg = readConfig(stateDir);
    const entries = readJsonl(filePath);
    const pruned = pruneEntries(entries, cfg);
    if (pruned.evicted > 0) {
      writeJsonlAtomic(filePath, pruned.entries);
    }
    return pruned.evicted;
  });
}

export {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_BYTES,
  DEFAULT_RESOLVED_TTL_MS,
  DEFAULT_LOG_TTL_MS,
  DEFAULT_MAX_LOG_ITEMS,
};
