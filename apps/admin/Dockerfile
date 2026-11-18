# app.prayer.tools (runs migrations on boot). Build context is the repo root.
FROM oven/bun:1.3
WORKDIR /app
COPY . .
# Layers first: shared depends on the fetched mail layer as a workspace.
RUN cd apps/admin && bun scripts/sync-layers.ts && cd /app && bun install
RUN bun run --cwd apps/admin build
ENV NODE_ENV=production
EXPOSE 3000
# Bun: the boot migrations import the layers' .ts migration files.
CMD ["bun", "apps/admin/.output/server/index.mjs"]
