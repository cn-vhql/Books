FROM node:24-bookworm AS web-builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS server-builder

WORKDIR /src/httpserver

ARG TARGETOS=linux
ARG TARGETARCH=amd64

COPY httpserver/go.mod httpserver/go.sum ./
RUN go mod download

COPY httpserver/. ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /out/httpserver .

FROM caddy:2

COPY --from=web-builder /app/build/ /usr/share/caddy/
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=server-builder /out/httpserver /app/httpserver
COPY --from=ghcr.io/cxfksword/douban-api-rs:latest /usr/bin/douban-api-rs /app/douban-api-rs

RUN mkdir -p /app/uploads && \
    chmod 755 /app/uploads && \
    printf '#!/bin/sh\nset -eu\ncd /app\n/app/httpserver &\nexec caddy run --config /etc/caddy/Caddyfile\n' > /start.sh && \
    chmod +x /start.sh

EXPOSE 80 8080 7200

ENV ENABLE_HTTP_SERVER=true
ENV ENABLE_LIBRARY_SERVER=true
ENV ENABLE_KOREADER_SERVER=false
ENV ENABLE_KOREADER_REGISTRATION=true
ENV ENABLE_OPDS=true

VOLUME ["/app/uploads"]

CMD ["/start.sh"]
