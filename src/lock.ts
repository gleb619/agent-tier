import { writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { isPidAlive } from './process-utils';

export function getLockDir(stateFilePath: string): string {
  return path.join(path.dirname(stateFilePath), 'locks');
}

export interface LockInfo {
	pid: number;
	hostname: string;
	startedAt: string;
	stateFile: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pathToLockName(filePath: string): string {
	const normalized = filePath.replace(/^\//, '').toLowerCase();
	const transformed = normalized.replace(/[/.]/g, '-');
	return `${transformed}.lock`;
}

export async function acquireLock(
	stateFilePath: string,
	timeoutMs = 5000
): Promise<string> {
	const lockDir = getLockDir(stateFilePath);
	mkdirSync(lockDir, { recursive: true });

	const lockPath = path.join(lockDir, pathToLockName(stateFilePath));
	const info: LockInfo = {
		pid: process.pid,
		hostname: os.hostname(),
		startedAt: new Date().toISOString(),
		stateFile: stateFilePath,
	};

	const deadline = Date.now() + timeoutMs;

	while (true) {
		try {
			writeFileSync(lockPath, JSON.stringify(info, null, 2), {
				flag: 'wx',
			});
			return lockPath;
		} catch (err: unknown) {
			if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
				let existingInfo: LockInfo | null = null;
				try {
					const content = readFileSync(lockPath, 'utf-8');
					existingInfo = JSON.parse(content) as LockInfo;
				} catch {
					// Lock file corrupted or unreadable, treat as dead
				}

				if (existingInfo && isPidAlive(existingInfo.pid)) {
					if (Date.now() < deadline) {
						await sleep(50);
						continue;
					} else {
						throw new Error(
							`Failed to acquire lock for ${stateFilePath} after ${timeoutMs}ms`
						);
					}
				}

				// Dead lock or unreadable, remove and retry
				try {
					unlinkSync(lockPath);
				} catch {
					// Ignore unlink errors
				}
				continue;
			}
			throw err;
		}
	}
}

export function releaseLock(lockPath: string): void {
	try {
		unlinkSync(lockPath);
	} catch {
		// Ignore all errors
	}
}

export async function withLock<T>(
	stateFilePath: string,
	fn: () => T | Promise<T>,
	timeoutMs?: number
): Promise<T> {
	const lockPath = await acquireLock(stateFilePath, timeoutMs);
	try {
		return await fn();
	} finally {
		releaseLock(lockPath);
	}
}
