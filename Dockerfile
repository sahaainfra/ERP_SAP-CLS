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
# PACK-W0-01 (container scan, runs #159/#160): take the Debian security fixes published since the base image was built (linux-pam
# CVE-2025-6020 was fixed in 1.5.2-6+deb12u3), and drop npm, npx and corepack, which the running application never uses: Trivy found
# HIGH advisories in the copies of undici and brace-expansion bundled inside the base image's npm, not in the application's own
# node_modules (package-lock.json pins brace-expansion 5.0.12 and has no undici).
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown node:node /data
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
