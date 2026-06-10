FROM nginx:alpine

# Create non-root user
RUN addgroup -g 101 -S nginxgroup && \
    adduser -u 101 -S nginxuser -G nginxgroup

# Copy site files
COPY html/ /usr/share/nginx/html/

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
    /etc/nginx/conf.d

# Create custom nginx config for non-root
RUN cat > /etc/nginx/nginx.conf << 'NGINXCONF'
user nginxuser;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;
events {
    worker_connections 1024;
}
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    gzip on;
    server {
        listen 80;
        server_name localhost;
        location / {
            root /usr/share/nginx/html;
            index index.html index.htm;
            try_files $uri $uri/ =404;
        }
        error_page 500 502 503 504 /50x.html;
        location = /50x.html {
            root /usr/share/nginx/html;
        }
    }
}
NGINXCONF

EXPOSE 80
USER nginxuser
