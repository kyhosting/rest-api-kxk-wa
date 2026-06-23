#!/bin/sh
set -e

for d in /app/storages /app/statics /app/statics/qrcode /app/statics/senditems /app/statics/media; do
    [ -d "$d" ] || mkdir -p "$d"
    chown -R gowauser:gowa "$d" 2>/dev/null || true
done

if [ -n "$PORT" ] && [ -z "$APP_PORT" ]; then
    export APP_PORT="$PORT"
fi

exec su-exec gowauser /app/whatsapp "$@"
