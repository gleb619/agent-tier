import { createSignal, createMemo, Accessor, Setter } from 'solid-js';
import { readFileSync } from 'fs';

const [currentLogFile, setCurrentLogFile] = createSignal<string | null>(null);
const [logLines, setLogLines] = createSignal<string[]>([]);
const [logFilter, setLogFilter] = createSignal<string>('');
const [scrollOffset, setScrollOffset] = createSignal<number>(0);
const [autoRefresh, setAutoRefresh] = createSignal<boolean>(true);

export {
  currentLogFile,
  setCurrentLogFile,
  logLines,
  logFilter,
  setLogFilter,
  scrollOffset,
  setScrollOffset,
  autoRefresh,
  setAutoRefresh,
};

export const filteredLines: Accessor<string[]> = createMemo(() => {
  const filter = logFilter().toLowerCase();
  if (!filter) return logLines();
  return logLines().filter((line) => line.toLowerCase().includes(filter));
});

export function loadLogFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf8');
    const lines = content.split('\n');
    setLogLines(lines);
    setScrollOffset(Math.max(0, lines.length - 40));
  } catch {
    setLogLines([]);
    setScrollOffset(0);
  }
}

export function refreshLog(): void {
  const file = currentLogFile();
  if (file) {
    try {
      loadLogFile(file);
    } catch {
      // silent
    }
  }
}

export function goToHead(): void {
  setScrollOffset(0);
}

export function goToTail(): void {
  setScrollOffset(Math.max(0, filteredLines().length - 40));
}