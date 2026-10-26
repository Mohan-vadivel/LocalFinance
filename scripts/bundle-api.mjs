// Builds a standalone copy of the API in release/smartfinora-api that installs with plain `npm install`,
// for servers without pnpm or Docker. The shared package is copied in under vendor/shared.
// Run from the repo root: pnpm bundle:api
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'release', 'smartfinora-api');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const writeJson = (p, data) => writeFileSync(join(out, p), JSON.stringify(data, null, 2) + '\n');

run('pnpm --filter @localfinance/shared build');
run('pnpm --filter @localfinance/api build');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'vendor', 'shared'), { recursive: true });
cpSync(join(root, 'apps/api/dist'), join(out, 'dist'), { recursive: true });
cpSync(join(root, 'apps/api/prisma'), join(out, 'prisma'), { recursive: true });
cpSync(join(root, 'packages/shared/dist'), join(out, 'vendor/shared/dist'), { recursive: true });

const shared = readJson('packages/shared/package.json');
writeJson('vendor/shared/package.json', {
  name: shared.name,
  version: shared.version,
  private: true,
  main: shared.main,
  types: shared.types,
  dependencies: shared.dependencies,
});

const api = readJson('apps/api/package.json');
writeJson('package.json', {
  name: 'smartfinora-api',
  version: api.version,
  private: true,
  main: 'dist/main.js',
  engines: { node: '>=18.18' },
  scripts: {
    // The code is already compiled; build only prepares the database
    build: 'prisma generate && prisma db push && node dist/seed.js',
    start: 'node dist/main.js',
    pm2: 'pm2 startOrRestart ecosystem.config.cjs && pm2 save',
    check: 'node check.cjs',
    setup: 'npm run build',
  },
  dependencies: {
    ...api.dependencies,
    '@localfinance/shared': 'file:./vendor/shared',
    // Needed at install time to generate the client and at setup to create the tables
    prisma: api.devDependencies.prisma,
  },
});

for (const f of ['check.cjs', 'app.js']) cpSync(join(root, 'scripts/api-bundle', f), join(out, f));
cpSync(join(root, 'scripts/api-bundle/htaccess.txt'), join(out, '.htaccess'));

// Copy the shared package into node_modules instead of linking it, so the folder can be moved or zipped
writeFileSync(join(out, '.npmrc'), 'install-links=true\n');

writeFileSync(
  join(out, 'ecosystem.config.cjs'),
  `// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{ name: 'smartfinora-api', script: 'dist/main.js', cwd: __dirname, max_memory_restart: '500M' }],
};
`,
);

writeFileSync(
  join(out, '.env.example'),
  `DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
# At least 32 random characters: openssl rand -hex 32
JWT_SECRET=change-me
PORT=4000
# The web admin address (several allowed, comma separated)
CORS_ORIGIN=https://app.example.com
UPLOAD_DIR=./uploads
# Super Admin created by "npm run seed". Change the password after the first login.
SUPER_ADMIN_PHONE=9000000000
SUPER_ADMIN_PASSWORD=ChangeMe@123
# SMS: "log" only records messages; "msg91" sends them
SMS_PROVIDER=log
MSG91_AUTH_KEY=
MSG91_SENDER=
# Optional: Claude key for the AI features
ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-5-5
`,
);

writeFileSync(
  join(out, 'README.txt'),
  `SmartFinora API, ready to run (Node.js 20 or 22, PostgreSQL). The code is already compiled.

First time:
  cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, CORS_ORIGIN
  npm install
  npm run build             # creates or updates the tables and the Super Admin
  npm install -g pm2
  npm run pm2               # starts the API in the background (restarts it if running)
  pm2 startup               # once: start it again after a server reboot
  npm run check             # says what is wrong, if anything

Without pm2, "npm start" runs it in this window.
On cPanel "Setup Node.js App", use app.js as the startup file.
If this folder is inside public_html, keep the .htaccess: it sends every request to the API,
so no file here (.env included) can be downloaded.

Updating: copy the new files over this folder (keep .env and uploads), then
  npm install && npm run build && npm run pm2
`,
);

console.log(`\nAPI bundle ready in ${out}`);
