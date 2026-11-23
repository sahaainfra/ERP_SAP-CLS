# Part 30.08 FR-01: the application image. One image for every environment (dev, test, staging, production, sandbox); the environment is
# configuration only (infra/environments/<name>.env plus secrets from the vault), so what is tested is what runs. Build:
#   docker build --build-arg BUILD_ID=$(git rev-parse --short HEAD) -t erp:$(git rev-parse --short HEAD) .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG BUILD_ID=local
ENV NODE_ENV=production BUILD_ID=${BUILD_ID} PORT=3000 DATABASE_PATH=/data/erp.sqlite STORAGE_PATH=/data/storage
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* && mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node seeds ./seeds
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server/index.js"]
