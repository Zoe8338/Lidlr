# Lidlr — single-file on-prem deployment
# Build: docker build -t lidlr .
# Run:   docker run -d -p 3000:3000 -v lidlr-data:/app/data lidlr
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_URL=file:/app/data/lidlr.db

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm cache clean --force

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && addgroup -S lidlr && adduser -S lidlr -G lidlr && mkdir -p /app/data && chown -R lidlr:lidlr /app
USER lidlr

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
