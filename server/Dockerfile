# Game server container. Builds the TypeScript backend and runs the compiled
# output. Works on Railway, Render, Fly.io, or any Docker host.
FROM node:20-slim AS base
# Prisma's query engine needs OpenSSL at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Build stage: install all deps, generate Prisma client, compile TS ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Production compile: excludes src/tests, so no test code ships in the image.
RUN npm run build:prod

# ---- Runtime stage: compiled output + full deps (incl. Prisma CLI/engines) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
# Reuse the build stage's installed modules so the Prisma CLI, query/migration
# engines, and the generated client are all present at runtime. (A pruned
# --omit=dev install would drop the `prisma` CLI, which the boot command needs.)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# Hosts inject PORT; 3001 is the local/default.
EXPOSE 3001

# On boot, sync the schema to the database (creates tables on a fresh DB),
# then start the server. Client is already generated, so skip regeneration.
#
# The audited alternative is `prisma migrate deploy`, and prisma/migrations/ (in
# the image, copied above) is ready for it - but it cannot be switched on here
# unilaterally. The live database was created by `db push`, so it has the tables
# without the `_prisma_migrations` bookkeeping table, and `migrate deploy`
# refuses that with `P3005: The database schema is not empty`. Baseline the
# existing database once (one command, no downtime, no data touched - see
# "Switching to migrate deploy" in DEPLOYMENT.md), then swap this line for:
#
#   CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && node dist/server.js"]
