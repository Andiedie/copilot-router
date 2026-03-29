FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && \
  rm -rf \
  node_modules/playwright \
  node_modules/playwright-core \
  node_modules/typescript \
  node_modules/@types \
  node_modules/.cache

FROM oven/bun:1-alpine AS release
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/data
EXPOSE 4141
CMD ["bun", "src/index.ts"]
