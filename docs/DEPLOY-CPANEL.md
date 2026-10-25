# Deploy SmartFinora on a cPanel server (without Docker)

Use this when the server already runs cPanel/WHM (AlmaLinux, CentOS, CloudLinux) and you cannot use Docker.
For a plain Ubuntu VPS, [DEPLOY.md](DEPLOY.md) with Docker is simpler.

Two rules that avoid most problems:

- **Keep the code outside `public_html`.** Everything in `public_html` can be downloaded from the web, including the
  `.env` file with your database password and secrets. Put the code in `/opt/smartfinora`, and copy only the built web files into `public_html`.
- **Install from the repo root, with pnpm.** The API uses the shared package through `workspace:*`, which plain `npm`
  does not understand. Running `npm i` inside `apps/api` always fails with `EUNSUPPORTEDPROTOCOL`.

The examples use `app.witsapps.com` (web admin) and `api.witsapps.com` (API).

## Shortcut: API only, with plain npm

If the server should only run the API, build a standalone copy on your own computer (or anywhere with the repo):

```bash
pnpm install
pnpm bundle:api          # writes release/smartfinora-api
```

Upload that folder to the server (outside `public_html`, e.g. `/opt/smartfinora-api`) and follow its `README.txt`:
`npm install`, `npm run setup`, `pm2 start ecosystem.config.cjs`. No pnpm or repo clone is needed on the server.
Then continue with step 6 (API subdomain) below.

## 1. Node.js 22 and pnpm

```bash
node -v                      # needs v20.6 or newer; v22 is best
```

If it is older or missing, install Node 22 (as root):

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs        # use yum on CentOS 7
```

Then pnpm, at the version the repo expects:

```bash
npm install -g pnpm@10.28.0 pm2
pnpm -v
```

## 2. PostgreSQL

In WHM, open **SQL Services > Configure PostgreSQL** and install it. Then in cPanel, **PostgreSQL Databases**:
create a database and a user with a strong password, and add the user to the database with all privileges.
cPanel adds your account prefix, e.g. database `teamwork_finance`, user `teamwork_finance`.

(Without WHM: `dnf install -y postgresql-server && postgresql-setup --initdb && systemctl enable --now postgresql`, then create the user and database with `sudo -u postgres psql`.)

## 3. Get the code and build

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/Mohan-vadivel/LocalFinance.git smartfinora
cd smartfinora
git checkout claude/project-thread-frt6rf     # or main once merged

# at the repo root, never inside apps/api (the filters skip the phone app)
pnpm install --frozen-lockfile --filter "@localfinance/api..." --filter "@localfinance/web..."
pnpm --filter @localfinance/shared build
```

The repo is private: Git asks for your GitHub username and a [personal access token](https://github.com/settings/tokens?type=beta) as the password.

## 4. API settings

```bash
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32        # use as JWT_SECRET
nano apps/api/.env
```

```
DATABASE_URL=postgresql://teamwork_finance:DB_PASSWORD@localhost:5432/teamwork_finance
JWT_SECRET=the-random-string
PORT=4000
CORS_ORIGIN=https://app.witsapps.com
UPLOAD_DIR=/opt/smartfinora-uploads
SUPER_ADMIN_PHONE=9000000000
SUPER_ADMIN_PASSWORD=ChangeMe@123
SMS_PROVIDER=log
ANTHROPIC_API_KEY=
```

If the database password has special characters such as `@` or `#`, write them URL-encoded (`@` is `%40`, `#` is `%23`).

## 5. Build the API, create the tables, start it

```bash
cd /opt/smartfinora/apps/api
mkdir -p /opt/smartfinora-uploads
pnpm build
npx prisma db push                      # creates the tables
node --env-file=.env dist/seed.js       # creates the Super Admin
pm2 start "node --env-file=.env dist/main.js" --name smartfinora-api
pm2 save && pm2 startup                 # restart it after a reboot (run the line pm2 prints)
curl http://127.0.0.1:4000/health       # {"ok":true,...}
```

## 6. API subdomain with HTTPS

1. cPanel > **Domains**: create `api.witsapps.com`. Note its document root (e.g. `/home/teamworkappz/api.witsapps.com`).
2. In that document root, create `.htaccess`:

   ```apache
   RewriteEngine On
   RewriteRule ^(.*)$ http://127.0.0.1:4000/$1 [P,L]
   ```

   This needs Apache's `mod_proxy` and `mod_proxy_http`, which are on by default in EasyApache 4 (WHM > EasyApache 4 if not).
3. cPanel > **SSL/TLS Status**: run AutoSSL for the subdomain.
4. Check: `curl https://api.witsapps.com/health`

## 7. Web admin

The web admin must sit at the root of its own (sub)domain, not in a folder like `/finance`, because its links start at `/`.

1. cPanel > **Domains**: create `app.witsapps.com` (or use an existing one). Note its document root.
2. Build with the API address and copy the files there:

   ```bash
   cd /opt/smartfinora
   VITE_API_URL=https://api.witsapps.com pnpm --filter @localfinance/web build
   cp -r apps/web/dist/. /home/teamworkappz/app.witsapps.com/
   chown -R teamworkappz:teamworkappz /home/teamworkappz/app.witsapps.com
   ```

3. In that document root, create `.htaccess` so page refreshes work:

   ```apache
   RewriteEngine On
   RewriteCond %{REQUEST_FILENAME} !-f
   RewriteCond %{REQUEST_FILENAME} !-d
   RewriteRule ^ index.html [L]
   ```

4. Run AutoSSL for it too, then open `https://app.witsapps.com` and log in as the Super Admin. Change the password.

## 8. Updating

```bash
cd /opt/smartfinora
git pull
pnpm install --frozen-lockfile --filter "@localfinance/api..." --filter "@localfinance/web..."
pnpm --filter @localfinance/shared build
cd apps/api && pnpm build && npx prisma db push && pm2 restart smartfinora-api
cd /opt/smartfinora
VITE_API_URL=https://api.witsapps.com pnpm --filter @localfinance/web build
cp -r apps/web/dist/. /home/teamworkappz/app.witsapps.com/
```

## 9. Backups

```bash
crontab -e
30 23 * * * pg_dump -Fc "postgresql://teamwork_finance:DB_PASSWORD@localhost:5432/teamwork_finance" > /opt/backups/db-$(date +\%F).dump && tar -czf /opt/backups/uploads-$(date +\%F).tgz -C /opt smartfinora-uploads
```

Create `/opt/backups` first, and copy it off the server regularly (cPanel Backup, or JetBackup if your host has it).
