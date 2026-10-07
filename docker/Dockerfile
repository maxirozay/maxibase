FROM node:24-alpine AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . ./

RUN pnpm build

FROM node:24-alpine
WORKDIR /app

RUN apk add --no-cache postgresql-client age

COPY --from=build /app/.output/ ./

CMD ["node", "./server/index.mjs"]