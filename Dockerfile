FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY README.md ./README.md
COPY .env.example ./.env.example

EXPOSE 3000
CMD ["npm", "start"]
