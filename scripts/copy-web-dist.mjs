// Vercel looks for an output directory relative to the project's root directory.
// Depending on how the project is configured that is `dist` or `apps/web/dist`, so after a
// root build the web bundle is also copied to ./dist and both settings find it.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const from = resolve(root, 'apps/web/dist');
const to = resolve(root, 'dist');

if (!existsSync(resolve(from, 'index.html'))) {
  console.error(`copy-web-dist: ${from} has no index.html; did the web build run?`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copy-web-dist: ${from} -> ${to}`);
