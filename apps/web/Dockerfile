# Web admin built into a Caddy image that also serves HTTPS for the API.
# Build from the repo root: docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile --filter @localfinance/web... \
 && pnpm --filter @localfinance/shared build \
 && pnpm --filter @localfinance/web build

FROM caddy:2
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
