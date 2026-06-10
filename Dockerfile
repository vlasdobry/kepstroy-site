FROM nginx:alpine

# Create non-root user
RUN addgroup -g 101 -S nginxgroup && \
    adduser -u 101 -S nginxuser -G nginxgroup

# Copy site files and custom nginx config
COPY html/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

# Create required directories with proper permissions
RUN mkdir -p /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp \
    /var/run \
    /tmp && \
    chown -R nginxuser:nginxgroup /var/cache/nginx \
    /var/run \
    /tmp \
    /usr/share/nginx/html \
    /var/log/nginx \
    /etc/nginx/conf.d

EXPOSE 80
USER nginxuser
