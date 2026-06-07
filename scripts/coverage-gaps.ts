#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  reset: '\x1b[0m'
};

function runVitestWithCoverage() {
  try {
    console.log('Running vitest with coverage...');
    execSync('npx vitest run --coverage', { stdio: 'inherit' });
  } catch (error) {
    console.warn('Warning: Vitest execution failed, but continuing with available coverage data...');
    // Continue anyway to show partial data
  }
}

function getAllTsFiles() {
  const srcDir = path.join(__dirname, '..', 'src');
  const excludeDirs = ['tui', 'types'];
  
  function getFilesRecursive(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip excluded directories
        if (excludeDirs.includes(entry.name)) {
          continue;
        }
        files.push(...getFilesRecursive(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  return getFilesRecursive(srcDir);
}

function readCoverageSummary() {
  const summaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(summaryPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading coverage-summary.json:', error.message);
    return null;
  }
}

function readCoverageFinal() {
  const finalPath = path.join(__dirname, '..', 'coverage', 'coverage-final.json');
  if (!fs.existsSync(finalPath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(finalPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading coverage-final.json:', error.message);
    return null;
  }
}

function getUncoveredFunctions(coverageData, filePath) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  
  if (!coverageData || !coverageData[relativePath]) {
    return null; // Indicates no tests
  }
  
  const fileCoverage = coverageData[relativePath];
  
  if (!fileCoverage.fnMap || !fileCoverage.f) {
    return [];
  }
  
  const uncovered = [];
  const fnMap = fileCoverage.fnMap;
  const hitCounts = fileCoverage.f;
  
  for (const fnId in fnMap) {
    if (hitCounts[fnId] === 0) {
      uncovered.push(fnMap[fnId].name);
    }
  }
  
  return uncovered;
}

function getLineCoveragePercentage(coverageData, filePath) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  
  if (!coverageData || !coverageData[relativePath]) {
    return null; // Indicates no tests
  }
  
  const fileCoverage = coverageData[relativePath];
  return fileCoverage.lines ? fileCoverage.lines.pct : 0;
}

function colorizeCoverage(percentage) {
  if (percentage === null) {
    return `${colors.yellow}NO TESTS${colors.reset}`;
  }
  
  if (percentage === 0) {
    return `${colors.red}${percentage.toFixed(1)}%${colors.reset}`;
  }
  
  if (percentage < 50) {
    return `${colors.yellow}${percentage.toFixed(1)}%${colors.reset}`;
  }
  
  if (percentage >= 80) {
    return `${colors.green}${percentage.toFixed(1)}%${colors.reset}`;
  }
  
  return `${percentage.toFixed(1)}%`;
}

function main() {
  // Run vitest with coverage
  runVitestWithCoverage();
  
  // Read coverage data
  const summaryData = readCoverageSummary();
  const finalData = readCoverageFinal();
  
  if (!summaryData) {
    console.error('No coverage data found. Make sure tests are running and generating coverage.');
    process.exit(1);
  }
  
  // Get all TypeScript files
  const allTsFiles = getAllTsFiles();
  
  // Prepare results
  const results = [];
  
  for (const filePath of allTsFiles) {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    const linePct = getLineCoveragePercentage(finalData, filePath);
    const uncoveredFunctions = getUncoveredFunctions(finalData, filePath);
    
    results.push({
      filePath: relativePath,
      linePct,
      uncoveredFunctions,
      hasTests: linePct !== null
    });
  }
  
  // Sort: 0% coverage first, then ascending by line coverage %
  results.sort((a, b) => {
    // Files with no tests (null) go to the end
    if (a.linePct === null && b.linePct === null) return 0;
    if (a.linePct === null) return 1;
    if (b.linePct === null) return -1;
    
    // 0% coverage first
    if (a.linePct === 0 && b.linePct !== 0) return -1;
    if (a.linePct !== 0 && b.linePct === 0) return 1;
    
    // Then sort by ascending percentage
    return a.linePct - b.linePct;
  });
  
  // Print table header
  console.log('\nCoverage Gap Analysis:');
  console.log('='.repeat(80));
  console.log(`${'Coverage'.padEnd(10)} | ${'File Path'.padEnd(50)} | Uncovered Functions`);
  console.log('-'.repeat(80));
  
  let totalFiles = 0;
  let uncoveredFiles = 0;
  let totalUncoveredFunctions = 0;
  
  // Print results
  for (const result of results) {
    totalFiles++;
    
    const coverageStr = colorizeCoverage(result.linePct);
    const filePathStr = result.filePath.padEnd(50);
    
    let functionsStr;
    if (result.uncoveredFunctions === null) {
      functionsStr = `${colors.yellow}NO TESTS${colors.reset}`;
    } else if (result.uncoveredFunctions.length === 0) {
      functionsStr = 'none';
    } else {
      functionsStr = result.uncoveredFunctions.join(', ');
    }
    
    console.log(`${coverageStr.padEnd(10)} | ${filePathStr} | ${functionsStr}`);
    
    if (result.linePct === 0 || result.linePct === null) {
      uncoveredFiles++;
    }
    
    if (result.uncoveredFunctions && result.uncoveredFunctions.length > 0) {
      totalUncoveredFunctions += result.uncoveredFunctions.length;
    }
  }
  
  // Print summary
  console.log('-'.repeat(80));
  console.log(`Summary: ${totalFiles} total files, ${uncoveredFiles} files needing coverage, ${totalUncoveredFunctions} uncovered functions`);
  
  // Print legend
  console.log(`\nLegend: ${colors.red}red${colors.reset} = 0% coverage, ${colors.yellow}yellow${colors.reset} = <50% coverage, ${colors.green}green${colors.reset} = >=80% coverage`);
}

main();