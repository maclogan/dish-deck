# ---- build (Debian-based so native build tools like the TypeScript compiler run everywhere)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- run (runtime dependencies are plain JavaScript, so a small Alpine image is enough)
FROM node:22-alpine
LABEL org.opencontainers.image.title="Dish Deck" \
      org.opencontainers.image.description="Swipe-to-plan meal discovery PWA for Mealie" \
      org.opencontainers.image.source="https://github.com/maclogan/dish-deck" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# No secrets in the image: configuration is injected at runtime (env_file, --env-file, or a Kubernetes Secret).
# /data holds the cache and household history; mount a volume there to keep it between updates.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "server/dist/index.js"]
