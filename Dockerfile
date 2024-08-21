FROM node:20-bullseye
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
WORKDIR /app
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
CMD ["node", "/app/server.js"]
