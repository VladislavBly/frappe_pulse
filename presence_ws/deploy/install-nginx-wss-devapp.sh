#!/usr/bin/env bash
# Nginx: wss://ws.devapp.uzcloud.uz → http://127.0.0.1:8765
# Запуск из любого каталога: sudo bash deploy/install-nginx-wss-devapp.sh
# Пути SSL — правьте CERT и KEY, если не Let’s Encrypt.

set -euo pipefail

DOMAIN="ws.devapp.uzcloud.uz"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Нужен root: sudo bash $0" >&2
	exit 1
fi
if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
	echo "Нет файлов SSL:" >&2
	echo "  $CERT" >&2
	echo "  $KEY" >&2
	exit 1
fi

sudo tee /etc/nginx/conf.d/00-websocket-upgrade.map.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
	default upgrade;
	''      close;
}
EOF

sudo tee /etc/nginx/sites-available/presence-ws >/dev/null <<EOF
server {
	listen 443 ssl;
	listen [::]:443 ssl;
	server_name ${DOMAIN};

	ssl_certificate     ${CERT};
	ssl_certificate_key ${KEY};

	location / {
		proxy_pass http://127.0.0.1:8765;
		proxy_http_version 1.1;
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \$connection_upgrade;
		proxy_read_timeout 86400s;
		proxy_send_timeout 86400s;
	}
}
EOF

sudo ln -sf /etc/nginx/sites-available/presence-ws /etc/nginx/sites-enabled/presence-ws
sudo nginx -t && sudo systemctl reload nginx

echo "Готово: wss://${DOMAIN}/?user_id=..."
