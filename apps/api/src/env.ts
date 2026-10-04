import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Loads apps/api/.env into process.env (values already set in the environment win). */
export function loadEnv() {
  const file = resolve(__dirname, '../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
