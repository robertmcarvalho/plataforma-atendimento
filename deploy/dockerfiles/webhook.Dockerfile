FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/webhook-service/package.json apps/webhook-service/package.json
COPY packages/channel-runtime/package.json packages/channel-runtime/package.json
COPY packages/logger/package.json packages/logger/package.json
RUN npm install --no-audit --no-fund

COPY apps/webhook-service apps/webhook-service
COPY packages/channel-runtime packages/channel-runtime
COPY packages/logger packages/logger
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=@plataforma/channel-runtime \
  && npm run build --workspace=apps/webhook-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/webhook-service/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
