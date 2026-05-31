import { mkdirSync, renameSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

export const BASE_DIR = join(homedir(), '.at', 'compose')

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function atomicWrite(filePath: string, data: string): void {
  ensureDir(dirname(filePath))
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, data, 'utf-8')
  renameSync(tmpPath, filePath)
}

export function readJsonFile<T>(filePath: string): T | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export function listJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}
