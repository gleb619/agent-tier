import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import os from 'os'

export interface ComposeConfig {
  pollIntervalMs: number
  maxConcurrentAgents: number
  stallTimeoutMs: number
  maxRetryAttempts: number
  storageDir: string
  logDir: string
}

export const DEFAULT_CONFIG: ComposeConfig = {
  pollIntervalMs: 2000,
  maxConcurrentAgents: 5,
  stallTimeoutMs: 300000,
  maxRetryAttempts: 3,
  storageDir: path.join(os.homedir(), '.at', 'compose'),
  logDir: '/tmp/at-logs',
}

function isValidPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function mergeWithDefaults(raw: unknown): ComposeConfig {
  const partial = typeof raw === 'object' && raw !== null ? (raw as Partial<ComposeConfig>) : {}

  return {
    pollIntervalMs: isValidPositiveNumber(partial.pollIntervalMs)
      ? partial.pollIntervalMs
      : DEFAULT_CONFIG.pollIntervalMs,
    maxConcurrentAgents: isValidPositiveNumber(partial.maxConcurrentAgents)
      ? partial.maxConcurrentAgents
      : DEFAULT_CONFIG.maxConcurrentAgents,
    stallTimeoutMs: isValidPositiveNumber(partial.stallTimeoutMs)
      ? partial.stallTimeoutMs
      : DEFAULT_CONFIG.stallTimeoutMs,
    maxRetryAttempts: isValidPositiveNumber(partial.maxRetryAttempts)
      ? partial.maxRetryAttempts
      : DEFAULT_CONFIG.maxRetryAttempts,
    storageDir: typeof partial.storageDir === 'string' && partial.storageDir.length > 0
      ? partial.storageDir
      : DEFAULT_CONFIG.storageDir,
    logDir: typeof partial.logDir === 'string' && partial.logDir.length > 0
      ? partial.logDir
      : DEFAULT_CONFIG.logDir,
  }
}

export function loadConfig(
  configPath: string = path.join(os.homedir(), '.at', 'compose', 'config.json')
): ComposeConfig {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  const content = readFileSync(configPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ...DEFAULT_CONFIG }
  }

  return mergeWithDefaults(parsed)
}

export function saveConfig(
  config: Partial<ComposeConfig>,
  configPath: string = path.join(os.homedir(), '.at', 'compose', 'config.json')
): void {
  const dir = path.dirname(configPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

export function getStorageDir(config: ComposeConfig): string {
  return config.storageDir
}
