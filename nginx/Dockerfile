FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY proxy-frontend.conf /etc/nginx/proxy-frontend.conf
COPY site /usr/share/nginx/site

# Official nginx image runs executable scripts in /docker-entrypoint.d before start.
# Written here so the script stays LF-only on Windows checkouts.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'user="${PM_BASIC_AUTH_USER:-pm}"' \
    'if [ -z "${PM_BASIC_AUTH_PASSWORD:-}" ]; then' \
    '  echo "PM_BASIC_AUTH_PASSWORD is required" >&2' \
    '  exit 1' \
    'fi' \
    'hash=$(openssl passwd -apr1 "$PM_BASIC_AUTH_PASSWORD")' \
    'printf "%s:%s\n" "$user" "$hash" > /etc/nginx/htpasswd' \
    'chmod 644 /etc/nginx/htpasswd' \
    > /docker-entrypoint.d/10-basic-auth.sh \
 && chmod 755 /docker-entrypoint.d/10-basic-auth.sh
