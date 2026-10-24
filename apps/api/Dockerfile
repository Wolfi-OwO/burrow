# syntax=docker/dockerfile:1
# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json IMPRESSUM.md PRIVACY.md TERMS_OF_USE.md ./
COPY apps/api/package.json apps/api/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --ignore-scripts --workspace apps/api --workspace apps/frontend --include-workspace-root
COPY apps/api apps/api
COPY apps/frontend apps/frontend
RUN npm run build --workspace apps/frontend && npm run build --workspace apps/api
RUN npm ci --ignore-scripts --omit=dev --workspace apps/api --include-workspace-root \
    && npm rebuild argon2 sharp

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/package.json package.json
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/database database
COPY --from=build /repo/apps/api/scripts scripts
COPY --from=build /repo/apps/frontend/dist public
ARG APP_VERSION=dev
ARG APP_REVISION=
ARG APP_BUILD_DATE=
ENV APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION APP_BUILD_DATE=$APP_BUILD_DATE BLOB_DIR=/data
LABEL org.opencontainers.image.source="https://github.com/Wolfi-OwO/burrow" org.opencontainers.image.revision=$APP_REVISION
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/livez').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations are idempotent and run before the server starts, so a new image never serves against an old schema.
CMD ["sh", "-c", "node scripts/run-migrations.mjs && exec node dist/server.js"]
