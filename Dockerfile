
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present
ENV WEB_PORT=3020
EXPOSE 3020
CMD ["npm", "start"]
