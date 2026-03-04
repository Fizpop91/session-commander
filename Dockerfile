# FROM node:22-bookworm-slim
FROM node:22-trixie-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    openssh-client \
    rsync \
    sshpass \
    && rm -rf /var/lib/apt/lists/*

ARG VITE_FIRST_RUN_WIZARD=true
ENV VITE_FIRST_RUN_WIZARD=${VITE_FIRST_RUN_WIZARD}

COPY package.json ./
COPY server ./server
COPY web ./web

RUN npm install
RUN npm run web:build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
