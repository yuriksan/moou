# ─── Development ───
FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY app/package.json ./app/
RUN npm install
COPY shared ./shared
COPY api ./api
COPY app ./app
CMD ["npm", "run", "dev"]

# ─── Build ───
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY app/package.json ./app/
RUN npm ci
COPY shared ./shared
COPY api ./api
COPY app ./app
# Build frontend
RUN npm run build --workspace=app
# Build backend (TypeScript → JS)
RUN npx tsc --project api/tsconfig.json || true

# ─── Production ───
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY app/package.json ./app/
RUN npm ci --omit=dev
RUN npm install tsx --save
# Copy API source
COPY api/src ./api/src
COPY api/tsconfig.json ./api/
COPY api/drizzle ./api/drizzle
COPY shared/src ./shared/src
COPY shared/tsconfig.json ./shared/
# Copy built frontend
COPY --from=build /app/app/dist ./app/dist
USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "api/src/index.ts"]
