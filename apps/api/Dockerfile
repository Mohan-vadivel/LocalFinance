# API image. Build from the repo root: docker build -f apps/api/Dockerfile .
# The full image (not -slim) already has the OpenSSL libraries Prisma needs.
FROM node:22-bookworm
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @localfinance/api... \
 && pnpm --filter @localfinance/shared build \
 && pnpm --filter @localfinance/api build
WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
EXPOSE 4000
# Applies schema changes (refuses ones that would lose data), makes sure the Super Admin exists, then starts.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/seed.js && node dist/main.js"]
