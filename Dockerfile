FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=8787 TRANSPORT=sim
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
