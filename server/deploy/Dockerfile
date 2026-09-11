# Gateway Stultus. Сборка из корня репозитория:
#   docker build -f server/deploy/Dockerfile -t stultus-gateway server
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Зависимости отдельно — слой кэшируется, пока package*.json не меняются.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
RUN npx --yes typescript@5 tsc -p tsconfig.json

# Сессии Claude Code и вход Codex живут в томах (см. docker-compose.yml).
VOLUME ["/root/.claude", "/root/.codex", "/app/data"]

EXPOSE 8790
CMD ["node", "dist/index.js"]
