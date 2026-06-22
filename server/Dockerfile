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

# ---- Runtime stage: production deps + compiled output + Prisma client ----
FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
# Bring the generated Prisma client over from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# Hosts inject PORT; 3001 is the local/default.
EXPOSE 3001

# On boot, sync the schema to the database (creates tables on a fresh DB),
# then start the server. For stricter control, switch to `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push && node dist/server.js"]
