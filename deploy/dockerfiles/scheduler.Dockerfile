FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/scheduler-service/package.json apps/scheduler-service/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/operational-notes/package.json packages/operational-notes/package.json
RUN npm install --no-audit --no-fund

COPY apps/scheduler-service apps/scheduler-service
COPY packages packages
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=@plataforma/operational-notes \
  && npm run build --workspace=apps/scheduler-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/scheduler-service/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
