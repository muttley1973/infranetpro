'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'backup_reset']);

function collectJsFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectJsFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.js')) continue;
    out.push(path.join(dir, entry.name));
  }
  return out;
}

const files = collectJsFiles(ROOT)
  .sort((a, b) => a.localeCompare(b))
  .map(file => path.relative(ROOT, file));

let failed = false;
for (const file of files) {
  const res = spawnSync(process.execPath, ['-c', file], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (res.status !== 0) {
    failed = true;
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
}

if (failed) process.exit(1);

console.log(`Syntax OK: ${files.length} file`);
