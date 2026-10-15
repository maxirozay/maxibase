FROM node:26-alpine AS build

RUN npm install -g corepack && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . ./

RUN pnpm build

FROM node:26-alpine
WORKDIR /app

RUN apk add --no-cache postgresql-client age

COPY --from=build /app/.output/ ./

CMD ["node", "./server/index.mjs"]