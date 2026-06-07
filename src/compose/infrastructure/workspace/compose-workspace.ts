import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export class ComposeWorkspace {
  readonly goalDir: string

  constructor(readonly goalId: string, baseDir?: string) {
    this.goalDir = path.join(
      baseDir ?? path.join(os.homedir(), '.at', 'compose'),
      goalId,
    )
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.goalDir, { recursive: true })
  }

  filePath(name: string): string {
    return path.join(this.goalDir, name)
  }

  async write(name: string, content: string): Promise<void> {
    await this.ensure()
    await fs.writeFile(this.filePath(name), content, 'utf8')
  }

  async read(name: string): Promise<string> {
    return fs.readFile(this.filePath(name), 'utf8')
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(name))
      return true
    } catch {
      return false
    }
  }

  async hasArchOutput(): Promise<boolean> {
    return (
      (await this.exists('requirements.md')) &&
      (await this.exists('design.md')) &&
      (await this.exists('tasks.md'))
    )
  }
}