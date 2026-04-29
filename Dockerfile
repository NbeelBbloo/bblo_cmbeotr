FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["npm", "start"]
