FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080
# DANFSe lib: JRE + jar (vendor copy or mount BILLING_DANFSE_LIB_JAR)
RUN apk add --no-cache openjdk17-jre-headless fontconfig ttf-dejavu \
  && mkdir -p /opt/danfse
COPY --from=build /app/vendor/xml-danfse-br/xml-danfse-br-cli.jar /opt/danfse/xml-danfse-br-cli.jar
ENV BILLING_DANFSE_LIB_JAR=/opt/danfse/xml-danfse-br-cli.jar
ENV BILLING_DANFSE_LIB_ENABLED=true
ENV BILLING_DANFSE_JAVA_BIN=java
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
EXPOSE 8080
CMD ["node", "dist/index.js"]
