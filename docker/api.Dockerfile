FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY infra/postgres/migrations infra/postgres/migrations
RUN npm run build --workspace=@follow115/contracts -- --force && npm run build --workspace=@follow115/api -- --force
CMD ["sh", "-c", "npm run db:migrate --workspace=@follow115/api && node apps/api/dist/server.js"]
