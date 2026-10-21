# syntax=docker/dockerfile:1

# ---- Build the React client ----
FROM node:22-alpine AS client-build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --no-audit --no-fund
COPY client client
RUN npm run build --workspace client

# ---- Runtime: Express API + built client ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=5000 \
    MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY server/src server/src
COPY --from=client-build /app/client/dist client/dist

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/src/index.js"]
