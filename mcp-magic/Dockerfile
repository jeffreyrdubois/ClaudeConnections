# ── Stage 1: Build React client ───────────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ── Stage 2: Build TypeScript server ──────────────────────────────────────────
FROM node:20-alpine AS server-builder

WORKDIR /app

# better-sqlite3 requires native build tools to compile from source
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install build tools needed by better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled server
COPY --from=server-builder /app/dist ./dist

# Copy built client — vite outDir is "../dist/public" relative to client/, so /app/dist/public
COPY --from=client-builder /app/dist/public ./dist/public

# Data directory for SQLite DB
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
