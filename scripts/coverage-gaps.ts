#!/usr/bin/env ts-node

/**
 * Coverage Gap Analysis — finds untested files/functions
 * Usage: npm run test:gaps
 *
 * Runs vitest with coverage, then parses the output to find
 * files and functions with no test coverage.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolve project root — use process.cwd() so ts-node works regardless of __dirname
const projectRoot = process.cwd();

const C = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function runVitestWithCoverage(): void {
  console.log(`${C.cyan}Running vitest with coverage...${C.reset}\n`);
  try {
    execSync('npx vitest run --coverage', {
      stdio: 'inherit',
      cwd: projectRoot
    });
  } catch {
    console.warn(`\n${C.yellow}Warning: vitest exited non-zero, analyzing available coverage data${C.reset}`);
  }
}

function getAllSrcFiles(): string[] {
  const srcDir = path.join(projectRoot, 'src');
  const excludeDirs = new Set(['tui', 'types']);
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) walk(full);
      } else if (entry.name.endsWith('.ts')) {
        results.push(full);
      }
    }
  }

  walk(srcDir);
  return results.sort();
}

interface FileResult {
  absPath: string;
  relPath: string;
  linePct: number | null;       // null = not in coverage data
  uncoveredFns: string[] | null; // null = not in coverage data
}

function analyze(): FileResult[] {
  const summaryPath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
  const finalPath = path.join(projectRoot, 'coverage', 'coverage-final.json');

  if (!fs.existsSync(summaryPath)) {
    console.error(`${C.red}No coverage data. Run "npm run test:coverage" first.${C.reset}`);
    process.exit(1);
  }

  const summary: Record<string, any> = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const finalData: Record<string, any> | null = fs.existsSync(finalPath)
    ? JSON.parse(fs.readFileSync(finalPath, 'utf8'))
    : null;

  const srcFiles = getAllSrcFiles();

  return srcFiles.map(absPath => {
    // Coverage uses absolute paths as keys
    const summaryEntry = summary[absPath];
    const finalEntry = finalData?.[absPath];

    if (!summaryEntry) {
      return { absPath, relPath: path.relative(projectRoot, absPath), linePct: null, uncoveredFns: null };
    }

    const linePct: number = summaryEntry.lines?.pct ?? 0;

    // Extract uncovered function names from Istanbul format
    let uncoveredFns: string[] = [];
    if (finalEntry?.fnMap && finalEntry?.f) {
      for (const id of Object.keys(finalEntry.fnMap)) {
        if (finalEntry.f[id] === 0) {
          const name = finalEntry.fnMap[id].name;
          if (name && name !== '<anonymous>') {
            uncoveredFns.push(name);
          }
        }
      }
    }

    return { absPath, relPath: path.relative(projectRoot, absPath), linePct, uncoveredFns };
  });
}

function colorize(pct: number | null): string {
  if (pct === null) return `${C.yellow}NO TESTS${C.reset}`;
  const s = pct.toFixed(1).padStart(6) + '%';
  if (pct === 0) return `${C.red}${s}${C.reset}`;
  if (pct < 50) return `${C.yellow}${s}${C.reset}`;
  if (pct >= 80) return `${C.green}${s}${C.reset}`;
  return s;
}

function printReport(results: FileResult[]): void {
  // Sort: null first (treated as -∞), then ascending by coverage %
  results.sort((a, b) => {
    const aVal = a.linePct === null ? -1 : a.linePct;
    const bVal = b.linePct === null ? -1 : b.linePct;
    return aVal - bVal;
  });

  const maxPathLen = Math.max(...results.map(r => r.relPath.length), 20);

  console.log(`\n${C.bold}Coverage Gap Analysis${C.reset}`);
  console.log('═'.repeat(90));
  console.log(
    '  ' + 'Coverage'.padEnd(10) + ' │ ' +
    'File'.padEnd(maxPathLen) + ' │ ' +
    'Uncovered Functions'
  );
  console.log('─'.repeat(90));

  let totalFiles = 0;
  let needCoverage = 0;
  let totalUncoveredFns = 0;

  for (const r of results) {
    totalFiles++;
    if (r.linePct === null || r.linePct === 0) needCoverage++;

    const cov = colorize(r.linePct).padEnd(10 + (r.linePct === null ? 0 : 0));
    const fp = r.relPath.padEnd(maxPathLen);

    let fns: string;
    if (r.uncoveredFns === null) {
      fns = `${C.yellow}NO TESTS${C.reset}`;
    } else if (r.uncoveredFns.length === 0) {
      fns = '✓ all covered';
    } else {
      fns = r.uncoveredFns.join(', ');
      totalUncoveredFns += r.uncoveredFns.length;
    }

    console.log(`  ${cov} │ ${fp} │ ${fns}`);
  }

  console.log('─'.repeat(90));
  console.log(
    `${C.bold}Summary:${C.reset} ${totalFiles} files, ` +
    `${C.red}${needCoverage} need coverage${C.reset}, ` +
    `${totalUncoveredFns} uncovered functions`
  );
  console.log(
    `\nLegend: ${C.red}red${C.reset} = 0%, ` +
    `${C.yellow}yellow${C.reset} = <50%, ` +
    `${C.green}green${C.reset} = ≥80%`
  );
}

// ── Main ──
runVitestWithCoverage();
const results = analyze();
printReport(results);
