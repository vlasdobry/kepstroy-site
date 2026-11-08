FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY index.js lead-message.js lead-delivery.js lead-duplicates.js max-client.js safe-request.js max-setup.js check-delivery.js submission-observability.js ./
COPY certs/ ./certs/
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data

EXPOSE 3000

USER node

CMD ["node", "index.js"]
