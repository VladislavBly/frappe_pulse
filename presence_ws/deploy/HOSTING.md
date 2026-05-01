# Хостинг presence-ws (Docker + TLS)

Краткий сценарий: **VPS с Docker**, сервис слушает **8765** внутри; наружу — **reverse proxy** с TLS и поддержкой **WebSocket**.

## 0. Автоскрипт (Debian/Ubuntu, root)

Из каталога **`presence_ws`**:

```bash
sudo chmod +x deploy/bootstrap-host.sh
sudo ./deploy/bootstrap-host.sh presence.example.com admin@youremail.com
```

Скрипт: ставит **Docker** (если нет), поднимает **compose**, копирует **`docker-compose.override.yml`** (порт только на **127.0.0.1**), ставит **Caddy**, пишет **`/etc/caddy/Caddyfile`** с **`wss`** на ваш домен. **DNS** на этот сервер должен быть настроен заранее.

Если на машине уже есть другие сайты в Caddy — бэкап старого `Caddyfile` делается, но лучше не запускать скрипт на «общем» хосте без правки вручную.

## 1. На сервере

```bash
sudo apt update && sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # затем перелогиниться
```

Клонируйте репозиторий, перейдите в `presence_ws`, скопируйте переменные:

```bash
cd frappe_pulse/presence_ws
cp deploy/env.example .env
# отредактируйте .env
docker compose build --no-cache presence-ws
docker compose up -d
curl -sS http://127.0.0.1:8765/health | head
```

Если в `.env` задан **`PRESENCE_X_API_TOKEN`**, добавьте заголовок:  
`-H "X-Api-Token: …"` (см. основной `README.md`).

## 2. Firewall

- Открывайте **443** (и **80** для ACME), если перед сервисом стоит Caddy/Nginx на той же машине.
- Порт **8765** наружу **не обязателен**, если прокси и presence на одном хосте: в `docker-compose.yml` можно сменить проброс на **`127.0.0.1:8765:8765`**, чтобы слушал только localhost.

Пример **ufw**:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. TLS и WebSocket (Caddy)

1. Установите [Caddy](https://caddyserver.com/docs/install) на ту же машину (или отдельный reverse-proxy).
2. Скопируйте `deploy/Caddyfile.example` → `/etc/caddy/Caddyfile` (или фрагмент в существующий конфиг), замените **`presence.example.com`** на ваш домен.
3. Upstream **`127.0.0.1:8765`** — presence-ws должен быть доступен с хоста Caddy (см. пункт про `127.0.0.1` в `ports`).
4. `caddy reload` или `systemctl reload caddy`.

Клиенты подключаются к **`wss://presence.example.com/`** (путь корневой, как у сервиса). Query как в README: **`?user_id=...`** или **`?ticket=...`** при проверке Frappe.

## 4. Frappe в Docker

Если Frappe в другом контейнере в **той же Docker-сети**, добавьте `presence-ws` в эту сеть и в **`FRAPPE_PRESENCE_VERIFY_URL`** укажите **`http://<имя_сервиса_frappe>:8000/...`**.  
С хоста через `host.docker.internal` (Linux) путь зависит от Docker — надёжнее общая **user-defined network** и имя контейнера.

Временно без проверки Frappe: **`FRAPPE_PRESENCE_VERIFY_ENABLED=false`** (см. основной README).

## 5. Обновление

```bash
cd frappe_pulse && git pull
cd presence_ws && docker compose build presence-ws && docker compose up -d
```

## Файлы в `deploy/`

| Файл | Назначение |
|------|------------|
| `env.example` | Шаблон `.env` для compose |
| `Caddyfile.example` | Пример TLS + WebSocket + проброс заголовков |

Подробности по API и Frappe — в **`../README.md`**.
