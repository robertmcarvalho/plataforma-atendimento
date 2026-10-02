# Build portal-patched DANFSe CLI (xml-danfse-br) — fat-jar ~7 MB
FROM maven:3.9-eclipse-temurin-17-alpine AS danfse-build
WORKDIR /danfse
COPY tools/xml-danfse-br/pom.xml tools/xml-danfse-br/LICENSE \
     tools/xml-danfse-br/NOTICE.md tools/xml-danfse-br/THIRD-PARTY.md ./
COPY tools/xml-danfse-br/src ./src
RUN mvn -Pcli -DskipTests -q package \
  && test -f target/xml-danfse-br-cli.jar

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api-service/package.json apps/api-service/package.json
COPY packages/ai-core/package.json packages/ai-core/package.json
COPY packages/channel-runtime/package.json packages/channel-runtime/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/financial-cycle/package.json packages/financial-cycle/package.json
COPY packages/operational-notes/package.json packages/operational-notes/package.json
COPY packages/ops-task-catalog/package.json packages/ops-task-catalog/package.json
COPY packages/billing-engine/package.json packages/billing-engine/package.json
COPY packages/flux-delivery/package.json packages/flux-delivery/package.json
RUN npm install --no-audit --no-fund

COPY apps/api-service apps/api-service
COPY packages packages
RUN npm run build --workspace=@plataforma/logger \
  && npm run build --workspace=@plataforma/operational-notes \
  && npm run build --workspace=@plataforma/ops-task-catalog \
  && npm run build --workspace=@plataforma/channel-runtime \
  && npm run build --workspace=@plataforma/financial-cycle \
  && npm run build --workspace=@plataforma/billing-engine \
  && npm run build --workspace=@plataforma/flux-delivery \
  && npm run build --workspace=@plataforma/ai-core \
  && npm run build --workspace=apps/api-service
RUN npm install --prefix apps/api-service --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# DANFSe portal-patched (OpenHTMLtoPDF needs fonts + fontconfig on Alpine)
RUN apk add --no-cache openjdk17-jre-headless fontconfig ttf-dejavu \
  && mkdir -p /opt/danfse
COPY --from=danfse-build /danfse/target/xml-danfse-br-cli.jar /opt/danfse/xml-danfse-br-cli.jar
ENV BILLING_DANFSE_LIB_JAR=/opt/danfse/xml-danfse-br-cli.jar
ENV BILLING_DANFSE_LIB_ENABLED=true
ENV BILLING_DANFSE_JAVA_BIN=java

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api-service/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api-service/dist ./dist
# Templates PIX C6 e demais assets estáticos usados em runtime (ex.: export diárias).
COPY --from=build /app/apps/api-service/assets ./assets
RUN mkdir -p node_modules/@plataforma \
  && ln -sfn ../../packages/logger node_modules/@plataforma/logger \
  && ln -sfn ../../packages/channel-runtime node_modules/@plataforma/channel-runtime \
  && ln -sfn ../../packages/ai-core node_modules/@plataforma/ai-core \
  && ln -sfn ../../packages/financial-cycle node_modules/@plataforma/financial-cycle \
  && ln -sfn ../../packages/operational-notes node_modules/@plataforma/operational-notes \
  && ln -sfn ../../packages/ops-task-catalog node_modules/@plataforma/ops-task-catalog \
  && ln -sfn ../../packages/billing-engine node_modules/@plataforma/billing-engine \
  && ln -sfn ../../packages/flux-delivery node_modules/@plataforma/flux-delivery
EXPOSE 8080
CMD ["node", "dist/index.js"]
