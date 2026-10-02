FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/campaign-worker/package.json apps/campaign-worker/package.json
COPY packages/logger/package.json packages/logger/package.json
RUN npm install --no-audit --no-fund

COPY apps/campaign-worker apps/campaign-worker
COPY packages/logger packages/logger
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=apps/campaign-worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/campaign-worker/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
