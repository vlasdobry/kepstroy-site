FROM nginx:alpine

# Remove the IPv6 entrypoint script that tries to modify read-only default.conf
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh

# Copy site files and custom nginx config
COPY html/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

# Create required directories with proper permissions for nginx user (uid 101)
RUN mkdir -p /var/cache/nginx/client_temp \
    /var/cache/nginx/proxy_temp \
    /var/cache/nginx/fastcgi_temp \
    /var/cache/nginx/uwsgi_temp \
    /var/cache/nginx/scgi_temp \
    /var/run \
    /tmp && \
    chown -R nginx:nginx /var/cache/nginx \
    /var/run \
    /tmp \
    /usr/share/nginx/html \
    /var/log/nginx \
    /etc/nginx/conf.d

EXPOSE 80
USER nginx
