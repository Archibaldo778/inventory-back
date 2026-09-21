FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    fonts-dejavu-core \
    fonts-liberation \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
