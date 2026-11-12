FROM node:22-alpine
WORKDIR /app
COPY server.js push.js package.json ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "server.js"]
