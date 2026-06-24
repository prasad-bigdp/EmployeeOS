# syntax=docker/dockerfile:1

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /app

# Copy manifests first so layer cache survives source-only changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/ai/package.json         ./packages/ai/
COPY packages/brain/package.json      ./packages/brain/
COPY packages/browser/package.json    ./packages/browser/
COPY packages/database/package.json   ./packages/database/
COPY packages/email/package.json      ./packages/email/
COPY packages/employees/package.json  ./packages/employees/
COPY packages/events/package.json     ./packages/events/
COPY packages/executor/package.json   ./packages/executor/
COPY packages/learner/package.json    ./packages/learner/
COPY packages/mcp/package.json        ./packages/mcp/
COPY packages/memory/package.json     ./packages/memory/
COPY packages/observer/package.json   ./packages/observer/
COPY packages/planner/package.json    ./packages/planner/
COPY packages/plugins/package.json    ./packages/plugins/
COPY packages/reporter/package.json   ./packages/reporter/
COPY packages/shared/package.json     ./packages/shared/
COPY packages/skills/package.json     ./packages/skills/
COPY packages/telegram/package.json   ./packages/telegram/
COPY apps/gateway/package.json        ./apps/gateway/
COPY apps/terminal/package.json       ./apps/terminal/
COPY apps/web/package.json            ./apps/web/

RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .

# Build everything (packages → web → gateway → terminal)
RUN pnpm turbo build

# Copy web UI into terminal dist for bundled serving
RUN cp -r apps/web/dist apps/terminal/dist/web


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Only copy what we need to run
COPY --from=builder /app/apps/terminal/dist             ./dist
COPY --from=builder /app/apps/terminal/node_modules     ./node_modules
COPY --from=builder /app/apps/terminal/package.json     ./package.json

# Playwright needs some system libs if used (optional, only for `employeeos browse`)
# RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

# The config and data live on the host — mount a volume
VOLUME ["/root/.employeeos"]

EXPOSE 3001

ENTRYPOINT ["node", "dist/index.js"]
CMD ["start"]
