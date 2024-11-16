FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Clean up dev dependencies
RUN npm prune --production

# Expose the port your app runs on
EXPOSE 3000

CMD ["npm", "start"]
