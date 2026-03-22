# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

# Python 3 is needed for the GEDCOM processing script
RUN apk add --no-cache python3

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY scripts/ ./scripts/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Data volume — mount your /data directory here (ancestry.ged goes in, ancestry.json comes out)
RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["./entrypoint.sh"]
