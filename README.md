# LocalFinance

Multi-tenant loans and collections platform for daily, weekly and monthly lending.

| Part | Folder | Stack |
| --- | --- | --- |
| API | `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16 |
| Web admin | `apps/web` | React 19, Vite 6, Leaflet (OpenStreetMap) |
| Android collection app | `apps/mobile` | Expo SDK 57 (React Native) |
| Shared code | `packages/shared` | Validation, loan maths, language files |

Languages live in `packages/shared/src/i18n/*.json` (English `en.json`, Tamil `ta.json`). To add a language, copy `en.json`, translate the values and add it to `LANGUAGES` in `packages/shared/src/i18n/index.ts`. `pnpm test` fails if a key is missing.

## Requirements

- Node.js 22 or newer and pnpm 10 (`corepack enable`)
- PostgreSQL 16 (or Docker: `docker compose up -d`)
- For the phone app: the Expo Go app or an Android emulator, and an Expo account to build the APK

## First run

```bash
pnpm install
pnpm build:shared

# API
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL and a long JWT_SECRET
cd apps/api
pnpm build
pnpm db:push                                # creates the tables
node dist/seed.js --demo                    # Super Admin plus a demo tenant (omit --demo for Super Admin only)
pnpm start                                  # http://localhost:4000
cd ../..

# Web admin
cp apps/web/.env.example apps/web/.env      # VITE_API_URL=http://localhost:4000
pnpm dev:web                                # http://localhost:3000
```

## Demo logins

| Role | Login (phone) | Password |
| --- | --- | --- |
| Super Admin | 9000000000 | ChangeMe@123 |
| Tenant owner | 9000000001 | Demo@1234 |
| Branch manager | 9000000002 | Demo@1234 |
| Loan officer | 9000000003 | Demo@1234 |
| Collection agent | 9000000004, 9000000005 | Demo@1234 |
| Accountant | 9000000006 | Demo@1234 |
| Auditor (read only) | 9000000007 | Demo@1234 |

Change the Super Admin password (`SUPER_ADMIN_PASSWORD` in `.env`) before going live.

## Android app

```bash
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_API_URL: http://10.0.2.2:4000 for the emulator,
# or http://<your PC's LAN IP>:4000 for a real phone on the same Wi-Fi
pnpm dev:mobile                             # scan the QR code with Expo Go
```

Build an installable APK with EAS (set the real API address in `apps/mobile/eas.json` first):

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas build -p android --profile preview      # APK for direct install
eas build -p android --profile production   # app bundle for Play Store
```

Collections and no-payment visits work offline: they are saved on the phone and sent automatically when the network returns. Adding customers and loan requests needs internet.

## Live server

`deploy/` holds a Docker Compose stack (Postgres, API, and Caddy serving the web admin with automatic HTTPS):

```bash
cp deploy/.env.example deploy/.env           # set both domains, passwords and JWT_SECRET
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

`deploy/backup.sh` backs up the database and uploaded files.

## Production notes

- Run the API behind HTTPS (nginx or a cloud load balancer) and set `CORS_ORIGIN` to the web address.
- `pnpm --filter @localfinance/web build` produces static files in `apps/web/dist` for any web host.
- Uploaded documents and bills are stored in `UPLOAD_DIR`; back this folder up with the database.
- SMS: `SMS_PROVIDER=log` only records messages. Set `SMS_PROVIDER=msg91` with `MSG91_AUTH_KEY` and `MSG91_SENDER` to send real SMS, and add the DLT-approved templates under Settings > SMS templates.

## Checks

```bash
pnpm test                                    # shared unit tests and API end-to-end tests (needs DATABASE_URL)
pnpm typecheck
pnpm --filter @localfinance/mobile bundle:check
```
