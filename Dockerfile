# Single image: builds the web client, then serves it from the API process.
# Node 24+ is required for node:sqlite; no native build steps, no extra services.
FROM node:24-slim AS web
WORKDIR /build
COPY app/web/package*.json ./app/web/
RUN cd app/web && npm install --no-audit --no-fund
COPY app/web ./app/web
COPY app/shared ./app/shared
RUN cd app/web && ./node_modules/.bin/vite build

FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY app/server/package*.json ./app/server/
RUN cd app/server && npm install --omit=dev --no-audit --no-fund
COPY app/server ./app/server
COPY app/shared ./app/shared
COPY --from=web /build/app/web/dist ./app/web/dist

# The database lives on a mounted volume so it survives redeploys.
ENV DB_FILE=/data/mathquest.db
VOLUME /data
EXPOSE 8080
ENV PORT=8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:8080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app/server/src/index.js"]
