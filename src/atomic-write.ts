import { promises as fs, renameSync, unlinkSync, writeFileSync } from "fs";

function tmpPathFor(file: string): string {
  return `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Write `content` to `file` atomically: content lands in a sibling temp file
 * first, then a same-directory rename swaps it in. A reader therefore never
 * observes a half-written file, and a crash mid-write leaves only the temp
 * file behind — which is cleaned up on the failure path.
 */
export function writeFileAtomicSync(file: string, content: string | Buffer): void {
  const tmp = tmpPathFor(file);
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup; surface the original rename error.
    }
    throw err;
  }
}

/** Async variant of {@link writeFileAtomicSync}. */
export async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  const tmp = tmpPathFor(file);
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // Best-effort cleanup; surface the original rename error.
    }
    throw err;
  }
}
