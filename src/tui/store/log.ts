import { createSignal, createMemo, Accessor } from 'solid-js';
import { readFile } from 'fs';

const [currentLogFile, setCurrentLogFile] = createSignal<string | null>(null);
const [logLines, setLogLines] = createSignal<string[]>([]);
const [logFilter, setLogFilter] = createSignal<string>('');
const [scrollOffset, setScrollOffset] = createSignal<number>(0);
const [autoRefresh, setAutoRefresh] = createSignal<boolean>(true);
const [isLoading, setIsLoading] = createSignal(false);

export {
  currentLogFile,
  setCurrentLogFile,
  logLines,
  setLogLines,
  logFilter,
  setLogFilter,
  scrollOffset,
  setScrollOffset,
  autoRefresh,
  setAutoRefresh,
  isLoading,
};

export const filteredLines: Accessor<string[]> = createMemo(() => {
  const filter = logFilter().toLowerCase();
  if (!filter) return logLines();
  return logLines().filter((line) => line.toLowerCase().includes(filter));
});

export const VISIBLE_LINES = 20;

export function loadLogFile(path: string): void {
  setIsLoading(true);
  readFile(path, 'utf8', (err, content) => {
    if (err) {
      setLogLines([]);
      setScrollOffset(0);
    } else {
      const lines = content.split('\n');
      setLogLines(lines);
      setScrollOffset(Math.max(0, lines.length - VISIBLE_LINES));
    }
    setIsLoading(false);
  });
}

export function refreshLog(): void {
  const file = currentLogFile();
  if (file) {
    loadLogFile(file);
  }
}

export function goToHead(): void {
  setScrollOffset(0);
}

export function goToTail(): void {
  setScrollOffset(Math.max(0, filteredLines().length - VISIBLE_LINES));
}