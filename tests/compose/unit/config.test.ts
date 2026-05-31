import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../../../src/compose/infrastructure/config'

describe('config', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'config-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadConfig returns defaults when file does not exist', () => {
    const configPath = path.join(tmpDir, 'nonexistent.json')
    const config = loadConfig(configPath)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it('loadConfig merges user config with defaults', () => {
    const configPath = path.join(tmpDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ pollIntervalMs: 9999 }))
    const config = loadConfig(configPath)
    expect(config.pollIntervalMs).toBe(9999)
    expect(config.maxConcurrentAgents).toBe(DEFAULT_CONFIG.maxConcurrentAgents)
    expect(config.stallTimeoutMs).toBe(DEFAULT_CONFIG.stallTimeoutMs)
    expect(config.maxRetryAttempts).toBe(DEFAULT_CONFIG.maxRetryAttempts)
    expect(config.storageDir).toBe(DEFAULT_CONFIG.storageDir)
    expect(config.logDir).toBe(DEFAULT_CONFIG.logDir)
  })

  it('loadConfig validates numeric fields — falls back to default on invalid value', () => {
    const configPath = path.join(tmpDir, 'config.json')
    writeFileSync(configPath, JSON.stringify({ pollIntervalMs: -100 }))
    const config = loadConfig(configPath)
    expect(config.pollIntervalMs).toBe(DEFAULT_CONFIG.pollIntervalMs)
  })

  it('saveConfig creates file', () => {
    const configPath = path.join(tmpDir, 'saved.json')
    saveConfig({ pollIntervalMs: 1000 }, configPath)
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ pollIntervalMs: 1000 })
  })

  it('loadConfig reads savedConfig correctly', () => {
    const configPath = path.join(tmpDir, 'roundtrip.json')
    saveConfig({ pollIntervalMs: 1234, maxRetryAttempts: 7 }, configPath)
    const config = loadConfig(configPath)
    expect(config.pollIntervalMs).toBe(1234)
    expect(config.maxRetryAttempts).toBe(7)
    expect(config.maxConcurrentAgents).toBe(DEFAULT_CONFIG.maxConcurrentAgents)
    expect(config.stallTimeoutMs).toBe(DEFAULT_CONFIG.stallTimeoutMs)
    expect(config.storageDir).toBe(DEFAULT_CONFIG.storageDir)
    expect(config.logDir).toBe(DEFAULT_CONFIG.logDir)
  })
})
