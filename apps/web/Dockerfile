FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
# Map display switch (deploy/README.md); empty values mean the defaults in trip-map*.tsx.
ARG NEXT_PUBLIC_MAP_PROVIDER
ARG NEXT_PUBLIC_MAP_TILES_URL
ARG NEXT_PUBLIC_MAP_GLYPHS_URL
ARG NEXT_PUBLIC_MAP_SPRITE_URL
ENV NEXT_PUBLIC_MAP_PROVIDER=$NEXT_PUBLIC_MAP_PROVIDER
ENV NEXT_PUBLIC_MAP_TILES_URL=$NEXT_PUBLIC_MAP_TILES_URL
ENV NEXT_PUBLIC_MAP_GLYPHS_URL=$NEXT_PUBLIC_MAP_GLYPHS_URL
ENV NEXT_PUBLIC_MAP_SPRITE_URL=$NEXT_PUBLIC_MAP_SPRITE_URL
RUN pnpm --filter web build

# Every page renders in the browser, so the build is plain files (next.config's
# output: "export") and Caddy serves them directly: no Node process for the website.
FROM caddy:2-alpine
COPY --from=build /app/apps/web/out /srv
