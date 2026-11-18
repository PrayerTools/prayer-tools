# Site domains, api., go., /my. Build context is the repo root.
FROM oven/bun:1.3 AS build
WORKDIR /app
# The mail kernel (@nuxtinator/mail) at the Nuxtinator tag layers.lock.json pins.
COPY apps/admin/layers.ts apps/admin/layers.lock.json apps/admin/
COPY apps/admin/scripts apps/admin/scripts
RUN cd apps/admin && bun scripts/sync-layers.ts --only mail
COPY package.json bun.lock bunfig.toml ./
# Bun requires every listed workspace to exist; their manifests are enough.
COPY apps/admin/package.json apps/admin/
COPY apps/worker/package.json apps/worker/
COPY apps/cli/package.json apps/cli/
COPY packages/shared packages/shared
COPY apps/public apps/public
RUN bun install --filter @prayertools/public
RUN bun run --cwd apps/public build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/apps/public/.output .output
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
