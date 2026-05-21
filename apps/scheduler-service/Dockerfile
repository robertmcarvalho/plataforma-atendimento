FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]


