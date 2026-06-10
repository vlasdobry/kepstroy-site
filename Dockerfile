FROM nginx:alpine

# Create non-root user for security
RUN addgroup -g 1001 -S nginxgroup && \
    adduser -u 1001 -S nginxuser -G nginxgroup

# Copy site files
COPY html/ /usr/share/nginx/html/

# Set proper ownership
RUN chown -R nginxuser:nginxgroup /usr/share/nginx/html

# Switch to non-root user
USER nginxuser

EXPOSE 80
