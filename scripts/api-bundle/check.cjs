// npm run check: tells you what is wrong with this server's setup, one line per check.
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const ok = (msg) => console.log(`  OK    ${msg}`);
const bad = (msg, fix) => {
  process.exitCode = 1;
  console.log(`  FAIL  ${msg}${fix ? `\n        -> ${fix}` : ''}`);
};

async function main() {
  console.log('SmartFinora API check\n');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 6) || major === 18) ok(`Node ${process.version}`);
  else bad(`Node ${process.version} is too old`, 'install Node 20 or 22');

  const envFile = join(__dirname, '.env');
  if (!existsSync(envFile)) return bad('.env is missing', 'cp .env.example .env, then fill it in');
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  ok('.env found');

  const env = process.env;
  if (!env.DATABASE_URL || env.DATABASE_URL.includes('USER:PASSWORD')) bad('DATABASE_URL is not set', 'postgresql://user:password@localhost:5432/database');
  if (!env.JWT_SECRET || env.JWT_SECRET === 'change-me' || env.JWT_SECRET.length < 32) bad('JWT_SECRET is missing or shorter than 32 characters', 'openssl rand -hex 32');
  else ok('JWT_SECRET set');
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.includes('example.com')) bad('CORS_ORIGIN is not set to your web address', 'e.g. CORS_ORIGIN=https://finance.witsapps.in');
  else ok(`CORS_ORIGIN ${env.CORS_ORIGIN}`);

  if (!existsSync(join(__dirname, 'node_modules'))) return bad('node_modules is missing', 'npm install');
  if (!existsSync(join(__dirname, 'node_modules/.prisma/client'))) return bad('Prisma client not generated', 'npm run build');

  if (env.DATABASE_URL) {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      ok('database connection');
      try {
        const n = await prisma.user.count();
        ok(`tables exist (${n} users)`);
        if (n === 0) bad('no users yet', 'npm run build (creates the Super Admin)');
      } catch {
        bad('tables are missing', 'npm run build');
      }
    } catch (e) {
      bad(`cannot connect to the database: ${String(e.message).split('\n').filter(Boolean).pop()}`, 'check DATABASE_URL; write @ in the password as %40 and # as %23');
    } finally {
      await prisma.$disconnect();
    }
  }

  const port = Number(env.PORT ?? 4000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) ok(`API is running on port ${port}`);
    else bad(`port ${port} answers with ${res.status}, it may be an old version or another app`, 'pm2 restart smartfinora-api');
  } catch {
    bad(`nothing is running on port ${port}`, 'npm run pm2 (or check: pm2 logs smartfinora-api)');
  }
  console.log(process.exitCode ? '\nFix the FAIL lines above and run npm run check again.' : '\nAll good.');
}
main();
