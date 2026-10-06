FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter api... --filter shared

FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

EXPOSE 4001
# DIRECT_URL defaults to DATABASE_URL: on the self-hosted server they're the same database,
# and an .env without DIRECT_URL must not stop the API from starting.
CMD ["sh", "-c", "export DIRECT_URL=\"${DIRECT_URL:-$DATABASE_URL}\" && apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main.js"]
