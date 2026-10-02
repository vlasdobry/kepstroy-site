FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY index.js lead-message.js lead-delivery.js max-client.js safe-request.js max-setup.js check-delivery.js ./
COPY certs/ ./certs/

EXPOSE 3000

USER node

CMD ["node", "index.js"]
