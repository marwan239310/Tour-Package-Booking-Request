
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./

COPY . .

EXPOSE 3001

CMD ["sh", "-c", "npm ci --omit=dev && npm start"]
