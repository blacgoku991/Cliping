# syntax=docker/dockerfile:1
# Une seule recette, deux images :
#   --target web     → le site (Next.js, serveur autonome)
#   --target worker  → le bot (capture des lives, montage, publication) avec ffmpeg, streamlink et yt-dlp

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Dépendances (le schéma Prisma est requis par le postinstall « prisma generate ») ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── Build du site ──
FROM deps AS build
COPY . .
# Valeur factice : le build ne se connecte jamais à la base, mais Prisma veut une URL bien formée.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" NEXT_OUTPUT=standalone
RUN npm run build

# ── Image du site ──
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Icônes de l'application installable (manifeste) et autres fichiers statiques.
COPY --from=build --chown=node:node /app/public ./public
# Moteur Prisma : copié explicitement, le traçage de Next ne l'embarque pas toujours.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ── Image du bot ──
FROM base AS worker
ENV NODE_ENV=production DATA_DIR=/data FONTS_DIR=/app/assets/fonts PATH="/opt/tools/bin:${PATH}"
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/tools \
 && /opt/tools/bin/pip install --no-cache-dir --upgrade streamlink yt-dlp \
 && mkdir -p /data && chown node:node /data
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node assets ./assets
COPY --chown=node:node src ./src
USER node
# tsx exécute directement le TypeScript : pas d'étape de compilation à maintenir pour le bot.
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]
