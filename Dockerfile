# Build stage: compile the API bundle and the web app.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Runtime stage: production dependencies + built artifacts only.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist

ENV WEB_DIST_PATH=/app/apps/web/dist
WORKDIR /app/apps/api
EXPOSE 3001
# Apply migrations, ensure the server row exists, then start.
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed.js && node dist/index.js"]
