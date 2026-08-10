FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS api-dependencies
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# One immutable image is started as two independent containers by Compose:
# nginx for the frontend and Node.js for the private OSS proxy.
FROM node:22-alpine AS runner
RUN apk add --no-cache nginx
WORKDIR /app
RUN mkdir -p /app/state && chown node:node /app/state
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=api-dependencies /app/server/node_modules /app/server/node_modules
COPY server/index.mjs /app/server/index.mjs
COPY server/src /app/server/src
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
