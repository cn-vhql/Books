#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${1:-koodo-centralized:local}"
STAGE_DIR="${ROOT_DIR}/.dist/image-root"
UPLOADS_DIR="${ROOT_DIR}/data/uploads"
CA_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

echo "[1/5] Build frontend with pnpm"
cd "${ROOT_DIR}"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm build

echo "[2/5] Build Go server binary"
cd "${ROOT_DIR}/httpserver"
CGO_ENABLED=0 GOOS=linux GOARCH="$(go env GOARCH)" go build -o "${ROOT_DIR}/httpserver/httpserver" .

echo "[3/5] Assemble local image root"
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/app" "${STAGE_DIR}/app/uploads" "${STAGE_DIR}/etc/ssl/certs"
cp -R "${ROOT_DIR}/build" "${STAGE_DIR}/app/build"
cp "${ROOT_DIR}/httpserver/httpserver" "${STAGE_DIR}/app/httpserver"
if [[ -f "${CA_CERT_FILE}" ]]; then
  cp "${CA_CERT_FILE}" "${STAGE_DIR}/etc/ssl/certs/ca-certificates.crt"
else
  echo "CA certificate bundle not found at ${CA_CERT_FILE}" >&2
  exit 1
fi

cat > "${STAGE_DIR}/Dockerfile" <<'EOF'
FROM scratch
WORKDIR /app
COPY app/ /app/
COPY etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV ENABLE_HTTP_SERVER=true
ENV ENABLE_LIBRARY_SERVER=true
ENV ENABLE_OPDS=true
ENV STATIC_DIR=/app/build
ENV PORT=8080
EXPOSE 8080 7200
VOLUME ["/app/uploads"]
ENTRYPOINT ["/app/httpserver"]
EOF

echo "[4/5] Build runtime image ${IMAGE_TAG}"
docker build -t "${IMAGE_TAG}" "${STAGE_DIR}"

echo "[5/5] Done"
echo
echo "Run with:"
echo "  mkdir -p ${UPLOADS_DIR}"
echo "  docker run -d --name koodo-centralized \\"
echo "    -p 8080:8080 \\"
echo "    -e SERVER_USERNAME=admin \\"
echo '    -e SERVER_PASSWORD="${SERVER_PASSWORD}" \\'
echo "    -v ${UPLOADS_DIR}:/app/uploads \\"
echo "    ${IMAGE_TAG}"
