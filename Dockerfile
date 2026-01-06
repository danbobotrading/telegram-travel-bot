# ============================================
# Telegram Travel Bot - Dockerfile
# ============================================

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Remove development files
RUN rm -rf tests scripts/migrations/*.js

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install runtime dependencies
RUN apk add --no-cache tini

# Copy built application from builder stage
COPY --from=builder /app /app

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Create necessary directories
RUN mkdir -p logs && chown nodejs:nodejs logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TINI_SUBREAPER=true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}/health', (r) => {if(r.statusCode !== 200) throw new Error()})"

# Use tini as init process
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "index.js"]

# Expose port
EXPOSE 3000

# Labels
LABEL maintainer="Travel Scout Team <team@travelscout.com>"
LABEL version="1.0.0"
LABEL description="Advanced Telegram Travel Bot for African routes with virtual interlining"
