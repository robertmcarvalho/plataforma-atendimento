FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api-service/package.json apps/api-service/package.json
COPY packages/ai-core/package.json packages/ai-core/package.json
COPY packages/channel-runtime/package.json packages/channel-runtime/package.json
COPY packages/logger/package.json packages/logger/package.json
RUN npm install --no-audit --no-fund

COPY apps/api-service apps/api-service
COPY packages packages
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=@plataforma/channel-runtime \
  && npm run build --workspace=@plataforma/ai-core \
  && npm run build --workspace=apps/api-service
RUN npm install --prefix apps/api-service --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api-service/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api-service/dist ./dist
RUN mkdir -p node_modules/@plataforma \
  && ln -sfn ../../packages/logger node_modules/@plataforma/logger \
  && ln -sfn ../../packages/channel-runtime node_modules/@plataforma/channel-runtime \
  && ln -sfn ../../packages/ai-core node_modules/@plataforma/ai-core
EXPOSE 8080
CMD ["node", "dist/index.js"]
