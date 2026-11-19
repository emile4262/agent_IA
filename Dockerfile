# Image de production de l'API de veille.
# Construction : docker build -t veille-api .
# Lancement :    docker run --env-file .env -p 3000:3000 veille-api

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=12.6.0

# --- 1. Compilation (avec les outils de développement) ---
FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# --- 2. Dépendances de production uniquement ---
FROM node:${NODE_VERSION} AS deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --- 3. Image finale : Node, dépendances de production et code compilé, sans les sources ---
FROM node:${NODE_VERSION}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Le serveur ne tourne pas en administrateur (root) dans le conteneur.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1
# node directement (et non pnpm) : il reçoit le signal d'arrêt et termine proprement les envois en cours.
CMD ["node", "dist/main.js"]
