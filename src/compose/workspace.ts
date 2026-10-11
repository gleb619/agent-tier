import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLAN_FILE = "plan.md";
export const VERDICT_FILE = "verdict.md";
export const CONTEXT_FILE = "context.md";

export class ComposeWorkspace {
  readonly goalDir: string;

  constructor(
    readonly goalId: string,
    baseDir?: string,
  ) {
    this.goalDir = path.join(baseDir ?? path.join(os.homedir(), ".at", "compose"), goalId);
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.goalDir, { recursive: true });
  }

  filePath(name: string): string {
    return path.join(this.goalDir, name);
  }

  async write(name: string, content: string): Promise<void> {
    await this.ensure();
    await fs.writeFile(this.filePath(name), content, "utf8");
  }

  async read(name: string): Promise<string> {
    return fs.readFile(this.filePath(name), "utf8");
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(name));
      return true;
    } catch {
      return false;
    }
  }

  async remove(name: string): Promise<void> {
    await fs.rm(this.filePath(name), { force: true });
  }

  async hasPlan(): Promise<boolean> {
    return this.exists(PLAN_FILE);
  }
}
