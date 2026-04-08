/**
 * `output: export` does not support App Router Route Handlers (`app/api/*`).
 * For S3/CloudFront the client calls Railway via `getApiUrl` anyway.
 * This script temporarily moves `app/api` aside, runs `STATIC_EXPORT=true next build`, then restores.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const apiDir = path.join(root, 'app', 'api');
const stash = path.join(root, '.stashed-next-api');

if (fs.existsSync(stash)) {
  console.error(
    'Found .stashed-next-api from a crashed build. Remove it after restoring app/api, or delete if app/api already exists.',
  );
  process.exit(1);
}
if (!fs.existsSync(apiDir)) {
  console.error('Expected app/api — nothing to stash.');
  process.exit(1);
}

fs.renameSync(apiDir, stash);

let code = 1;
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, STATIC_EXPORT: 'true' },
  });
  code = r.status ?? 1;
} finally {
  if (fs.existsSync(stash)) {
    fs.renameSync(stash, apiDir);
  }
}

process.exit(code);
