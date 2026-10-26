# Deploy SmartFinora on a cPanel server

For a cPanel/WHM server (AlmaLinux, CentOS, CloudLinux) with root access. No Docker, pnpm or PM2 is needed on the server:
the `server/` folder is the API, already compiled, with a `package.json` that plain `npm` installs.

The examples use `finance.witsapps.in`, with the API under `https://finance.witsapps.in/api`.

## 1. Node.js and PostgreSQL

```bash
node -v        # needs v20 or v22
```

PostgreSQL: in WHM open **SQL Services > Configure PostgreSQL** and install it. Then in cPanel, **PostgreSQL Databases**:
create a database and a user with a strong password, and add the user to the database with all privileges.
cPanel adds your account prefix, e.g. database `teamwork_finance`, user `teamwork_finance`.

## 2. Get the code (outside public_html)

Everything in `public_html` can be downloaded from the web, including `.env` with your passwords, so the code goes next to it:

```bash
git clone https://github.com/Mohan-vadivel/LocalFinance.git /home/teamworkappz/smartfinora
cd /home/teamworkappz/smartfinora
git checkout claude/project-thread-frt6rf     # or main once merged
```

The repo is private: Git asks for your GitHub username and a [personal access token](https://github.com/settings/tokens?type=beta) as the password.

## 3. Start the API

```bash
cd /home/teamworkappz/smartfinora/server
cp .env.example .env
openssl rand -hex 32      # use as JWT_SECRET
nano .env
```

```
DATABASE_URL=postgresql://teamwork_finance:DB_PASSWORD@localhost:5432/teamwork_finance
JWT_SECRET=the-random-string
PORT=4000
CORS_ORIGIN=https://finance.witsapps.in
UPLOAD_DIR=./uploads
SUPER_ADMIN_PHONE=9000000000
SUPER_ADMIN_PASSWORD=ChangeMe@123
SMS_PROVIDER=log
```

If the database password has `@` or `#`, write them as `%40` and `%23`.

```bash
npm install
npm run build      # creates or updates the tables and the Super Admin
npm run service    # runs the API as a Linux service: starts on boot, restarts if it stops
npm run check      # says what is wrong, if anything
```

`npm run logs` shows the API's last 50 log lines, `npm run restart` restarts it.

## 4. Send /api to the API

Copy `server/.htaccess` into the folder that serves the domain (it also has the web admin rules from step 5), or add this rule to the existing `.htaccess` there:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
RewriteRule ^api/?(.*)$ http://127.0.0.1:4000/$1 [P,L,QSA]
```

This needs Apache's `mod_proxy` and `mod_proxy_http` (on by default in EasyApache 4). Run AutoSSL in cPanel > **SSL/TLS Status**
for HTTPS. Check: `curl https://finance.witsapps.in/api/health` returns `{"ok":true,...}`.

## 5. Web admin

The web admin is built once on a computer with the repo and pnpm, with the API address baked in:

```bash
VITE_API_URL=https://finance.witsapps.in/api pnpm --filter @localfinance/web build
```

Upload the contents of `apps/web/dist` to the domain's folder. It must be the root of a (sub)domain, not a subfolder,
because its links start at `/`. Add these lines after the `/api` rule in the same `.htaccess`, so page refreshes work:

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
```

Open the site, log in as the Super Admin and change the password.

## 6. Updating

```bash
cd /home/teamworkappz/smartfinora && git pull
cd server && npm install && npm run build && npm run restart
```

Developers: after changing `apps/api` or `packages/shared`, run `pnpm bundle:api` and commit `server/`.

## 7. Backups

```bash
mkdir -p /home/teamworkappz/backups
crontab -e
30 23 * * * pg_dump -Fc "postgresql://teamwork_finance:DB_PASSWORD@localhost:5432/teamwork_finance" > /home/teamworkappz/backups/db-$(date +\%F).dump && tar -czf /home/teamworkappz/backups/uploads-$(date +\%F).tgz -C /home/teamworkappz/smartfinora/server uploads
```

Copy the backups off the server regularly (cPanel Backup, or JetBackup if your host has it).
