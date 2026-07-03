# -----------------------------------------------------------------------------
# Multi-stage Dockerfile for the React Vite Frontend (Dashboard)
# -----------------------------------------------------------------------------

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the React application for production
RUN npm run build

# Stage 2: Runner
FROM nginx:alpine AS runner

# Remove default NGINX static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built static assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom NGINX configuration for SPA routing and API proxying
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Start NGINX
CMD ["nginx", "-g", "daemon off;"]
