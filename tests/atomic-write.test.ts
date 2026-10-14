import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomic, writeFileAtomicSync } from "../src/atomic-write";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "at-atomic-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFileAtomicSync", () => {
  it("writes content to the target file", () => {
    const file = path.join(tmp(), "a.txt");
    writeFileAtomicSync(file, "hello");
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("overwrites an existing file", () => {
    const file = path.join(tmp(), "a.txt");
    writeFileSync(file, "old", "utf8");
    writeFileAtomicSync(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("leaves no temp files behind", () => {
    const dir = tmp();
    writeFileAtomicSync(path.join(dir, "a.txt"), "x");
    writeFileAtomicSync(path.join(dir, "a.txt"), "y");
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });
});

describe("writeFileAtomic", () => {
  it("writes content to the target file", async () => {
    const file = path.join(tmp(), "a.txt");
    await writeFileAtomic(file, "hello");
    expect(readFileSync(file, "utf8")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const file = path.join(tmp(), "a.txt");
    writeFileSync(file, "old", "utf8");
    await writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("leaves no temp files behind", async () => {
    const dir = tmp();
    const file = path.join(dir, "a.txt");
    await writeFileAtomic(file, "x");
    await writeFileAtomic(file, "y");
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });

  it("survives parallel writes and leaves no temp files", async () => {
    const dir = tmp();
    const file = path.join(dir, "many.txt");
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, `value-${i}`)));
    expect(readdirSync(dir)).toEqual(["many.txt"]);
    expect(readFileSync(file, "utf8")).toMatch(/^value-\d+$/);
  });
});
