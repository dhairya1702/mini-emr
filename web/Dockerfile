FROM node:22-slim AS deps

WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm ci

FROM node:22-slim AS builder

WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY . /app

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NODE_ENV=production

RUN mkdir -p /app/public
RUN npm run build

FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/public /app/public
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/next.config.mjs /app/next.config.mjs
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 8080

CMD ["sh", "-c", "npm run start -- --hostname 0.0.0.0 --port ${PORT:-8080}"]
