FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js cli.js health.js redis-presence.js frappe-verify.js ./

USER node

ENV NODE_ENV=production
ENV PORT=8765
ENV HOST=0.0.0.0

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8765/health || exit 1

CMD ["node", "server.js"]
