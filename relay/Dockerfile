FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    OFFICEX_RELAY_LISTEN_MULTIADDRS=/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws \
    OFFICEX_RELAY_KEY_FILE=/data/identity.key

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown -R node:node /app /data

COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 4001/tcp 4002/tcp
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
