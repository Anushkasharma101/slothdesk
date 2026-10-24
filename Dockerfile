FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --include=dev
COPY client ./client
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4100
ENV STORAGE_DIR=/app/server/storage
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --omit=dev && mkdir -p /app/server/storage && chown -R node:node /app/server/storage
COPY --from=build /app/client/dist ./client/dist
COPY server/src ./server/src
USER node
EXPOSE 4100
CMD ["npm", "start"]
