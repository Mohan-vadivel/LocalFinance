// npm run backup: saves the database (pg_dump) and the uploaded files into backups/, keeping the last 14 days.
// npm run backup:daily: (as root) runs it every night at 02:30 through /etc/cron.d/smartfinora-backup.
// Restore a database file: gunzip -c backups/db-DATE.sql.gz | psql "$DATABASE_URL"
const { execFileSync, execSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');

const dir = __dirname;
const env = { ...process.env };
if (existsSync(join(dir, '.env'))) {
  for (const line of readFileSync(join(dir, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const out = resolve(dir, env.BACKUP_DIR || 'backups');
const keepDays = Number(env.BACKUP_KEEP_DAYS || 14);

if (process.argv[2] === 'daily') {
  const line = `30 2 * * * root cd ${dir} && ${process.execPath} ${join(dir, 'backup.cjs')} >> ${join(out, 'backup.log')} 2>&1\n`;
  mkdirSync(out, { recursive: true });
  writeFileSync('/etc/cron.d/smartfinora-backup', line);
  console.log(`Daily backup set for 02:30 into ${out} (last ${keepDays} days kept).`);
  process.exit(0);
}

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is missing in .env');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const dbFile = join(out, `db-${stamp}.sql.gz`);
// pg_dump does not accept Prisma's ?schema= option
const url = env.DATABASE_URL.replace(/[?&]schema=[^&]*/, '');
execSync(`pg_dump --no-owner --no-privileges "${url}" | gzip > "${dbFile}"`, { stdio: ['ignore', 'inherit', 'inherit'], shell: '/bin/bash' });
if (statSync(dbFile).size < 1000) {
  console.error(`Backup looks empty: ${dbFile}. Check that pg_dump works and DATABASE_URL is right.`);
  process.exit(1);
}
const uploads = resolve(dir, env.UPLOAD_DIR || 'uploads');
if (existsSync(uploads)) execFileSync('tar', ['-czf', join(out, `uploads-${stamp}.tar.gz`), '-C', uploads, '.']);

// Remove backups older than keepDays
const cutoff = Date.now() - keepDays * 86400000;
for (const f of readdirSync(out)) {
  if (/^(db|uploads)-.*\.gz$/.test(f) && statSync(join(out, f)).mtimeMs < cutoff) rmSync(join(out, f));
}
console.log(`${new Date().toISOString()} backup saved: ${dbFile}`);
