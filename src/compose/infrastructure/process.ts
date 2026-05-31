import { spawn as nodeSpawn } from 'child_process'
import type { IProcessManager } from '../application/ports'

export class ProcessManager implements IProcessManager {
  private pids = new Set<number>()

  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> },
  ): { pid: number } {
    const child = nodeSpawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: 'ignore',
    })
    if (child.pid === undefined) {
      throw new Error('Failed to spawn: no PID')
    }
    this.pids.add(child.pid)
    child.unref()
    return { pid: child.pid }
  }

  async kill(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already dead
    }
    await new Promise<void>((r) => setTimeout(r, 5000))
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already dead
    }
    this.pids.delete(pid)
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}

export function createProcessManager(): ProcessManager {
  return new ProcessManager()
}
