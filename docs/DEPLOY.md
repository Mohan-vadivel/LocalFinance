# Deploy SmartFinora to a VPS

This puts the API, the web admin and the database on one Ubuntu server, with free HTTPS that renews itself.
Everything runs in Docker, so the server only needs Docker and Git.

What runs on the server (`deploy/docker-compose.yml`):

| Service | What it is | Reachable from the internet |
|---|---|---|
| `web` | Caddy: serves the web admin and gets HTTPS certificates | Yes, ports 80 and 443 |
| `api` | NestJS API, behind Caddy | Only through `https://API_DOMAIN` |
| `db` | PostgreSQL 16 | No |

The examples use `app.witsapps.com` for the web admin and `api.witsapps.com` for the API. Use any two names you own.

## 1. Get a server

- Any VPS provider works (Hostinger, DigitalOcean, AWS Lightsail, Hetzner, Contabo, E2E Networks...).
- Ubuntu 24.04 LTS (22.04 is fine too).
- At least 2 GB RAM and 2 vCPU, 40 GB disk. The first build needs the memory; 1 GB servers need the swap file from step 3.
- Pick a region near your users (Mumbai or Chennai for Tamil Nadu).

Note the server's public IP address.

## 2. Point the domain at the server

At your domain registrar (where witsapps.com is managed), add two DNS records:

| Type | Name | Value |
|---|---|---|
| A | `app` | your server IP |
| A | `api` | your server IP |

Check they work before going on (this can take a few minutes to an hour):

```bash
ping app.witsapps.com
ping api.witsapps.com
```

Both should show your server IP. HTTPS in step 6 fails until they do.

## 3. Prepare the server

Log in as root (your provider shows the password or SSH key), then:

```bash
ssh root@YOUR_SERVER_IP

# Updates and basics
apt update && apt upgrade -y
apt install -y git ufw

# Firewall: only SSH and web traffic
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Docker (official script)
curl -fsSL https://get.docker.com | sh

# Only on servers with less than 2 GB RAM: add 2 GB of swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Get the code

```bash
cd /opt
git clone https://github.com/Mohan-vadivel/LocalFinance.git
cd LocalFinance
git checkout main        # or the branch you want to run
```

The repository is private, so Git asks for a username and password. Use your GitHub username and a
[personal access token](https://github.com/settings/tokens?type=beta) with read access to this repo as the password.

## 5. Fill in the settings

```bash
cp deploy/.env.example deploy/.env
openssl rand -hex 32     # run twice: one for POSTGRES_PASSWORD, one for JWT_SECRET
nano deploy/.env
```

| Setting | What to put |
|---|---|
| `APP_DOMAIN` | `app.witsapps.com` |
| `API_DOMAIN` | `api.witsapps.com` |
| `POSTGRES_PASSWORD` | the first random string |
| `JWT_SECRET` | the second random string |
| `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_PASSWORD` | the first Super Admin login. Change the password after you log in. |
| `SMS_PROVIDER` | `log` to only record SMS, `msg91` to send real ones |
| `MSG91_AUTH_KEY`, `MSG91_SENDER` | from MSG91, only with `SMS_PROVIDER=msg91` |
| `ANTHROPIC_API_KEY` | optional, from console.anthropic.com, for the AI features |

Save with Ctrl+O, Enter, Ctrl+X. Keep this file private, and keep a copy somewhere safe: without `POSTGRES_PASSWORD` a backup cannot be restored onto the running stack.

## 6. Start it

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The first build takes 5 to 10 minutes. Then check:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps     # all three "Up"
curl https://api.witsapps.com/health                                      # {"ok":true,...}
```

Open `https://app.witsapps.com` and log in with the Super Admin phone and password. Change the password, then create the first business from the Super Admin screens.

If HTTPS does not work, look at Caddy's log. It is almost always DNS not pointing at the server yet, or ports 80/443 blocked by the provider's own firewall panel:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs web
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs api
```

## 7. Point the Android app at the server

The phone app reads the API address when it is built. In `apps/mobile/.env` set:

```
EXPO_PUBLIC_API_URL=https://api.witsapps.com
```

then build the APK / AAB as usual and install it on the agents' phones.

## 8. Daily backups

`deploy/backup.sh` saves the database and uploaded documents to `/opt/backups` and keeps 30 days.

```bash
crontab -e
# add this line: backup every night at 11:30 pm server time
30 23 * * * cd /opt/LocalFinance && sh deploy/backup.sh >> /var/log/smartfinora-backup.log 2>&1
```

A backup on the same server is lost if the server is lost. Copy `/opt/backups` off the server regularly too, for example with your provider's snapshot feature, or with `rclone` to Google Drive or S3.

To restore a day's backup (this replaces the current data):

```bash
cd /opt/LocalFinance
sh deploy/restore.sh 2026-10-25
```

## 9. Updating to a new version

```bash
cd /opt/LocalFinance
sh deploy/update.sh
```

This takes a backup, pulls the latest code on the current branch, rebuilds and restarts. Database changes are applied on start;
a change that would delete data is refused and the API stops with an error in `logs api`, so nothing is lost silently.
Users see a short break of under a minute while the API restarts.

## Everyday commands

All from `/opt/LocalFinance`:

```bash
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
$DC ps                 # what is running
$DC logs -f api        # follow the API log
$DC restart api        # restart the API
$DC down               # stop everything (data is kept)
$DC up -d              # start again
```

## Security checklist

- Change the Super Admin password after the first login.
- Log in with an SSH key and turn off password login (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- Run `apt update && apt upgrade -y` monthly.
- The database is not open to the internet; do not add a `ports:` line to `db`.
