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

# On boot, apply any pending migrations from prisma/migrations (copied into the
# image above), then start the server. The client is already generated, so there
# is nothing to regenerate.
#
# `migrate deploy` applies only what is recorded and refuses a database whose
# state it does not recognise, instead of silently reshaping it the way `db push`
# would. The live database was baselined with `migrate resolve --applied 0_init`,
# so its recorded history starts from that migration.
#
# Do not run `db push` against production from here on. It would change the
# schema without recording it, leaving `migrate deploy` working from a false
# picture of the database. Schema changes go through `npm run db:migrate`
# locally, committed together with their migration - see DEPLOYMENT.md section 1.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
