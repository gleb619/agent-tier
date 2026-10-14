# syntax=docker/dockerfile:1
# WebUI-included image: `docker build -t at . && docker run -p 7800:7800 at`
# Serves the `at web` server (REST + SSE + built Svelte WebUI) on port 7800.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Workspace root + webui member manifests first for a cached deps layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/webui/package.json src/webui/package.json
RUN pnpm install --frozen-lockfile
# Full source, then root build = tsc (dist/) + vite build (src/webui/dist).
COPY . .
RUN pnpm run build

FROM golang:1.21-bookworm AS go-builder
WORKDIR /build
COPY web-server/ .
RUN go build -trimpath -ldflags "-s -w" -o /build/at-web ./cmd/at-web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# `at web` serves the built WebUI from <pkg>/src/webui/dist by default.
COPY --from=build /app/src/webui/dist ./src/webui/dist
COPY --from=go-builder /build/at-web ./bin/at-web
# Ship node runtime + `at` CLI symlink so `at` commands work in container.
RUN ln -sf /app/dist/cli.js /usr/local/bin/at && chmod +x /app/dist/cli.js
ENV PATH="/usr/local/bin:${PATH}"
EXPOSE 7800
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["web", "--port", "7800", "--host", "0.0.0.0"]
