# Production image for Google Cloud Run (Next.js standalone).
# Build from MONOREPO ROOT (postbuild needs scripts/prepare-web-standalone.mjs):
#
#   docker build -f apps/web/Dockerfile .
#
# Pass production NEXT_PUBLIC_* at build time (baked into the bundle):
#   docker build -f apps/web/Dockerfile . \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     ...

FROM node:20-alpine AS base
WORKDIR /workspace

FROM base AS build

# Standalone post-build script (resolved from apps/web as ../../scripts/...)
COPY scripts/prepare-web-standalone.mjs ./scripts/

COPY packages/operational-notes/package.json ./packages/operational-notes/package.json
COPY packages/operational-notes ./packages/operational-notes
RUN cd packages/operational-notes && npm install --no-audit --no-fund && npm run build

COPY packages/channel-runtime/package.json ./packages/channel-runtime/package.json
COPY packages/channel-runtime ./packages/channel-runtime
RUN cd packages/channel-runtime && npm install --no-audit --no-fund && npm run build

COPY apps/web/package*.json ./apps/web/
COPY apps/web ./apps/web

WORKDIR /workspace/apps/web

# Client-side env (must be set at image build, not only at Cloud Run runtime)
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_SUPABASE_URL=
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_ENABLE_INSTAGRAM=false
ARG NEXT_PUBLIC_ENABLE_EMAIL=false
ARG NEXT_PUBLIC_ENABLE_AI_SUGGESTIONS=false
ARG NEXT_PUBLIC_AI_ANALYSIS_BADGES=true
ARG NEXT_PUBLIC_AI_SUGGEST_REPLY=true
ARG NEXT_PUBLIC_AI_INBOUND_ASSIST=true
ARG NEXT_PUBLIC_ENABLE_TICKETING_PANEL=true

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_ENABLE_INSTAGRAM=$NEXT_PUBLIC_ENABLE_INSTAGRAM
ENV NEXT_PUBLIC_ENABLE_EMAIL=$NEXT_PUBLIC_ENABLE_EMAIL
ENV NEXT_PUBLIC_ENABLE_AI_SUGGESTIONS=$NEXT_PUBLIC_ENABLE_AI_SUGGESTIONS
ENV NEXT_PUBLIC_AI_ANALYSIS_BADGES=$NEXT_PUBLIC_AI_ANALYSIS_BADGES
ENV NEXT_PUBLIC_AI_SUGGEST_REPLY=$NEXT_PUBLIC_AI_SUGGEST_REPLY
ENV NEXT_PUBLIC_AI_INBOUND_ASSIST=$NEXT_PUBLIC_AI_INBOUND_ASSIST
ENV NEXT_PUBLIC_ENABLE_TICKETING_PANEL=$NEXT_PUBLIC_ENABLE_TICKETING_PANEL

ENV WEB_NEXT_DIST_DIR=.next_local
# next.config enables standalone when CI=true (Docker / Cloud Build)
ENV CI=true

RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Entire standalone tree (flat or nested after prepare-web-standalone.mjs)
COPY --from=build /workspace/apps/web/.next_local/standalone .

EXPOSE 8080
CMD ["node", "server.js"]
