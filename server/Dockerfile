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
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

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
# For stricter control later, switch to `prisma migrate deploy`.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && node dist/server.js"]
