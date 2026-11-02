FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY db.js web-server.js sqlserver-mcp.js ./
COPY public ./public
ENV WEB_HOST=0.0.0.0 WEB_PORT=3000
EXPOSE 3000
CMD ["node", "web-server.js"]
