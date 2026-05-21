FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/orchestrator-service/package.json apps/orchestrator-service/package.json
COPY packages/ai-core/package.json packages/ai-core/package.json
COPY packages/channel-runtime/package.json packages/channel-runtime/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/operational-notes/package.json packages/operational-notes/package.json
RUN npm install --no-audit --no-fund

COPY apps/orchestrator-service apps/orchestrator-service
COPY packages packages
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=@plataforma/operational-notes \
  && npm run build --workspace=@plataforma/channel-runtime \
  && npm run build --workspace=@plataforma/ai-core \
  && npm run build --workspace=apps/orchestrator-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/orchestrator-service/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
