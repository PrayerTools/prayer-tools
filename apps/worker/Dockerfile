# Reminders, jobs, marketing delivery, daily sweeps. Build context is the repo root.
FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# Bun requires every listed workspace to exist; their manifests are enough.
COPY apps/admin/package.json apps/admin/
COPY apps/public/package.json apps/public/
COPY apps/cli/package.json apps/cli/
COPY packages/shared packages/shared
COPY apps/admin/apps/marketing/lib apps/admin/apps/marketing/lib
COPY apps/worker apps/worker
RUN bun install --omit=dev --filter @prayertools/worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["bun", "src/index.ts"]
