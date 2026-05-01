# presence-ws

На одном порту: **HTTP** и **WebSocket**. Все публичные GET завязаны на **один сегмент пути** (как **`/health`** → за прокси **`/_presence/health`**): **`/health`**, **`/metrics`**, **`/summary`**, **`/services`**, **`/list`**, **`/online`** (тот же ответ, что **`/list`** — список сессий и фильтры в query), плюс админские **`POST /kick`**, **`/kick-all`**, **`/admin/*`**. Путей вида **`/online/summary`** нет — такой URL часто ломается в nginx; используй **`/summary`**. Сервер — **uWebSockets.js** (npm `uwebsockets`). Образ Docker — **Debian bookworm-slim**.

**Идентификатор пользователя (opaque) обязателен**, если **не** включена проверка через Frappe (см. **`FRAPPE_PRESENCE_VERIFY_*`** и флаг **`FRAPPE_PRESENCE_VERIFY_ENABLED`** ниже): его нужно передать **в query при установлении WebSocket** — в том же URL, куда клиент делает запрос **HTTP Upgrade** (`GET` с заголовком `Upgrade: websocket`). Параметры **`?user_id=...`** или **`?sub=...`** (до 512 символов). Опционально метка источника клиента: **`?client_service=...`**, или коротко **`?svc=...`**, **`?from=...`**, **`?service=...`** (до 64 символов) — попадает в события **`welcome`** / **`join`** / **`leave`** как **`client_service`**, список сессий по HTTP — **`GET /list`** или **`GET /online`** с теми же query-фильтрами; сводки — **`GET /summary`**, **`GET /services`**. Если ни одного не передали или строка пустая, сервер **не выполняет апгрейд**: ответ **HTTP 403**, до протокола WebSocket дело не доходит (ни **`welcome`**, ни событий сокета).

Несколько сокетов с **одинаковым** `user_id` считаются **одним** пользователем: в ответах **`unique_users`**, в Redis — SET `uniq` + refcount.

**Redis:** сессии в **HASH** `sessions`, уникальные `user_id` в **SET** `uniq`, refcount в **HASH** `ref` (см. ключи с hash-tag в `redis-presence.js`). **`GET /health`**, **`GET /metrics`** и **`GET /online`** отражают **`connections`** и **`unique_users`** (в JSON и в метриках).

В событиях присутствия **нет** счётчиков: **`welcome`** / **`join`** / **`leave`** содержат **`session_id`** (UUID этой сессии, уникальная на каждое подключение), **`clientId`** (то же значение, совместимость), **`user_id`** (opaque пользователя), при передаче в URL — **`client_service`** (метка источника). Полные цифры — **`GET /health`**, **`GET /metrics`**, **`GET /online`**, **`info`** / **`stats`** по сокету.

### Переменные окружения (Redis и масштаб)

| Переменная | Назначение |
|------------|------------|
| **`REDIS_URL`** | Например `redis://redis:6379`. Если не задан — Redis не используется. |
| **`REDIS_REQUIRED`** | `1` / `true` — выход при недоступности Redis при старте. |
| **`PRESENCE_TENANT`** | Префикс логического tenant (по умолчанию `default`). |
| **`PRESENCE_SERVICE_ID`** | Идентификатор сервиса (по умолчанию `presence-ws`). |
| **`NODE_INSTANCE_ID`** | Метка ноды в JSON сессии в Redis (по умолчанию `HOSTNAME` или `node`). |
| **`FRAPPE_PRESENCE_VERIFY_URL`** | **POST** на Frappe, например `http://backend:8000/api/pulse/internal/presence-ws-upgrade-verify`. Задаётся **вместе** с **`FRAPPE_PRESENCE_VERIFY_SECRET`** и при включённой проверке WebSocket **не** принимает произвольный `user_id` из query: идентификатор берётся только после ответа Frappe. |
| **`FRAPPE_PRESENCE_VERIFY_SECRET`** | Совпадает с **`pulse_presence_auth_secret`** в `site_config.json` сайта Frappe (заголовок **`X-Pulse-Presence-Secret`**). |
| **`FRAPPE_PRESENCE_VERIFY_TIMEOUT_MS`** | Таймаут запроса к Frappe при Upgrade (по умолчанию **5000**). |
| **`FRAPPE_PRESENCE_VERIFY_ENABLED`** | **`false`** / **`0`** / **`off`** / **`no`** / **`disabled`** — **выключить** проверку Frappe при Upgrade, даже если заданы **`FRAPPE_PRESENCE_VERIFY_URL`** и **`FRAPPE_PRESENCE_VERIFY_SECRET`** (временно для тестов без Frappe). Пусто или **`true`** — включено, когда URL и секрет заданы. |
| **`PRESENCE_X_API_TOKEN`** | Если задан — все **`GET`** (`/health`, `/online`, `/metrics`) только с заголовком **`X-Api-Token: <token>`** или **`Authorization: Bearer <token>`**. Для Prometheus можно по-прежнему использовать **`bearer_token_file`**. Устаревший алиас: **`METRICS_AUTH_TOKEN`** (то же значение, если `PRESENCE_X_API_TOKEN` пуст). |

### Prometheus и Grafana

**`GET /metrics`** отдаёт текст в формате **Prometheus** (`Content-Type: text/plain; version=0.0.4`). Счётчики совпадают по смыслу с **`/health`**: `presence_ws_connections`, `presence_ws_connections_local`, `presence_ws_unique_users`, `presence_ws_uptime_seconds`, `presence_ws_redis_connected`, плюс флаги `presence_ws_frappe_upgrade_verify_enabled`, `presence_ws_admin_http_enabled`.

Проверка с хоста:

```bash
curl -sS http://127.0.0.1:8765/metrics | head -40
# при заданном PRESENCE_X_API_TOKEN:
# curl -sS -H "X-Api-Token: $PRESENCE_X_API_TOKEN" http://127.0.0.1:8765/metrics | head -40
```

Фрагмент **`prometheus.yml`**:

```yaml
scrape_configs:
  - job_name: presence_ws
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["127.0.0.1:8765"]
    # Если задан PRESENCE_X_API_TOKEN (или METRICS_AUTH_TOKEN) у presence-ws:
    # bearer_token_file: /run/secrets/presence_metrics_bearer
```

В **Grafana** добавьте источник **Prometheus** и панели по именам метрик выше (лейблы **`tenant`**, **`service_id`**).

### Деплой на сервер (кратко)

1. **`docker compose up -d`** в каталоге `presence_ws` (или свой compose с теми же образом/переменными). Redis должен быть доступен контейнеру `presence-ws` по **`REDIS_URL`**.
2. **Порт 8765** наружу — только если нужен доступ с клиентов; в проде часто оставляют доступ **только из внутренней сети** или за reverse proxy с TLS.
3. **Прокси** (Nginx / Caddy / Traefik): для WebSocket пробросьте **`Upgrade`** и **`Connection`**; **`/health`**, **`/online`**, **`/metrics`** и **`/admin/*`** ограничьте по IP/VPN, если задан **`PRESENCE_X_API_TOKEN`** — прокси должен пробрасывать заголовок к upstream (или ограничить доступ только Prometheus).
4. **Несколько реплик:** scrape **каждую** реплику Prometheus’ом; `presence_ws_connections` при работающем Redis отражает кластер, `presence_ws_connections_local` — только эту ноду. Суммировать «local» по всем подам как «всего соединений» обычно **нельзя** (двойной счёт), ориентируйтесь на Redis-агрегат или на один срез.

Пошаговый хостинг (VPS, firewall, Caddy, Frappe): **`deploy/HOSTING.md`** и примеры **`deploy/env.example`**, **`deploy/Caddyfile.example`**. Автоустановка (Docker + Caddy): **`deploy/bootstrap-host.sh`** (см. HOSTING.md §0).

---

### Проверка сессии через Frappe (`pulse_app`)

1. В **`site_config.json`** сайта Frappe задайте общий секрет (тот же, что в **`FRAPPE_PRESENCE_VERIFY_SECRET`** у presence-ws):

   ```json
   "pulse_presence_auth_secret": "длинная-случайная-строка"
   ```

   Опционально TTL одноразового билета (секунды, по умолчанию 120, макс. 600):

   ```json
   "pulse_presence_ticket_ttl": 120
   ```

2. **Внутренний** эндпоинт (вызывает только **presence-ws**, не браузер): **`POST /api/pulse/internal/presence-ws-upgrade-verify`**  
   Заголовки: **`Content-Type: application/json`**, **`X-Pulse-Presence-Secret`**.  
   Тело: **`{"ticket":"<от ws-ticket>"}`** и/или **`{"sid":"<Frappe session id>"}`**.  
   Приоритет: сначала **ticket** (одноразовый), иначе **sid** (строка сессии из `tabSessions`).  
   Ответ **`200`**: `{"data":{"user_id":"<имя пользователя Frappe>"}}` — это значение уходит в **`user_id`** в событиях присутствия.

3. **Билет для браузера** (пользователь уже залогинен в Frappe, обычный **`POST`** с CSRF, как у остальных запросов Desk): **`POST /api/pulse/presence/ws-ticket`**  
   Ответ: `{"data":{"ticket":"...","expires_in":120}}`.  
   Дальше WebSocket (при включённой проверке):

   ```text
   ws://<presence-host>:8765/?ticket=<ticket>
   ```

   Параметр **`sid`** в query или cookie **`sid`** на том же хосте, что и presence, имеет смысл в основном при **прокси с одним origin** (чтобы браузер прислал cookie на тот же хост, куда уходит Upgrade).

4. Пока проверка Frappe **выключена** (нет **`FRAPPE_PRESENCE_VERIFY_URL`+`SECRET`**, либо **`FRAPPE_PRESENCE_VERIFY_ENABLED=false`** и т.п.), поведение как раньше: в query обязательны **`user_id`** или **`sub`** (без проверки Frappe).

---

## Клиент (подключение к сокету)

Одна команда — подставьте свой хост/порт, если не `127.0.0.1:8765`:

```bash
npx wscat -c "ws://127.0.0.1:8765/?user_id=u-opaque-123"
```

#### Fedora / Linux: `websocat` через Cargo

В репозиториях Fedora пакета `websocat` может не быть — соберите из crates.io:

```bash
sudo dnf install cargo
cargo install websocat
```

Бинарник обычно в **`~/.cargo/bin/websocat`**. Добавьте в `PATH`, если нужно: `export PATH="$HOME/.cargo/bin:$PATH"` (или постоянно в `~/.bashrc`).

Подключение (хост/порт и `user_id` подставьте свои):

```bash
~/.cargo/bin/websocat 'ws://127.0.0.1:8765/?user_id=u-opaque-123'
```

Без **`user_id` / `sub`** на этапе Upgrade клиент получит **403** и WebSocket не откроется. После успешного апгрейда приходит **`welcome`** с **`session_id`**, **`clientId`**, **`user_id`**; остальным **`join`** / **`leave`**: то же.

### Команды по WebSocket (только info / stats)

Отправьте **текст или JSON** в открытый сокет (без админского секрета — его **нельзя** слать в общий WS-канал):

| Действие | Пример | Ответ |
|----------|--------|--------|
| Жив ли сервис, список сессий | текст `info` или `{"cmd":"info"}` | **`clients`**: **`session_id`**, **`user_id`**, … |
| Короткая сводка | текст `stats` или `{"cmd":"stats"}` | `connections`, **`unique_users`**, `uptimeSec`, `alive` |

Попытки **kick** по сокету получают подсказку перейти на **HTTP** (см. ниже).

### Админ: kick только по HTTP

Секрет задаётся переменной **`ADMIN_TOKEN`** на сервере. Передавайте его **только** в заголовке (не в query, не в WebSocket):

- **`X-Admin-Token: <ADMIN_TOKEN>`** или **`Authorization: Bearer <ADMIN_TOKEN>`**

| Действие | HTTP | Тело (JSON) |
|----------|------|-------------|
| Выгнать одну сессию | **`POST /admin/kick`** | `{"session_id":"<uuid>"}` (допустимы поля `id` / `clientId` / `target`) |
| Отключить всех | **`POST /admin/kick-all`** | Тело не обязательно (`Content-Length: 0` или `{}`) |

Ответы: **`200`** `{"ok":true,"session_id":"..."}` или `{"ok":true,"disconnected":N}`; **`403`** при неверном токене; **`503`** если **`ADMIN_TOKEN`** не задан.

Пример:

```bash
curl -sS -X POST "http://127.0.0.1:8765/admin/kick" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"session_id":"<uuid>"}'
```

---

## Сервер: CLI и статистика (через Docker)

Сводка по HTTP и интерактивный CLI — по желанию; **`GET /health`** по-прежнему самый простой мониторинг без JSON-команд в сокете.

### Быстрый онлайн по HTTP (документация / мониторинг)

- **`GET /health`** — `connections` (все сокеты), **`unique_users`**, `connections_local`, `redis`, …
- **`GET /summary`** — компактно: **`total`** (`connections`, `unique_users` по всем), **`breakdown`** — массив `{ client_service, connections, unique_users }` по каждой метке (`client_service: null` — без метки), **`by_service`** — то же по ключам; без метки в **`by_service`** ключ **`_untagged`**. За nginx: **`/_presence/summary`** (один сегмент после префикса, как для **`/health`**).
- **`GET /services`** — **`services`**, **`service_stats`**, глобальные **`connections`** / **`unique_users`**, без **`clients`**. За nginx: **`/_presence/services`**.
- **`GET /list`** и **`GET /online`** — один обработчик: массив **`clients`** и счётчики (или при фильтре — только выбранная метка). Фильтры: **`?client_service=`**, **`?svc=`**, **`?client_service=__none__`**; при фильтре в теле **`filter`**. За nginx: **`/_presence/list`** или **`/_presence/online`**.
- **`GET /metrics`** — текст Prometheus (**`metrics_path`** для scrape обычно **`/metrics`**; алиас не нужен).
- **`POST /admin/kick`**, **`POST /admin/kick-all`** — отключить сессию / все (заголовок **`X-Admin-Token`** или Bearer, см. **`ADMIN_TOKEN`**). Короткие пути: **`POST /kick`**, **`POST /kick-all`** (то же поведение).

### Все HTTP-пути (и алиасы под nginx)

| Метод | Основной путь | Алиас (тот же обработчик) |
|-------|----------------|---------------------------|
| **GET** | `/health` | — |
| **GET** | `/metrics` | — |
| **GET** | `/summary` | — |
| **GET** | `/services` | — |
| **GET** | `/online` | **`/list`** |
| **POST** | `/admin/kick` | **`/kick`** |
| **POST** | `/admin/kick-all` | **`/kick-all`** |

WebSocket: **`GET`** с Upgrade на **`/`** (любой путь вида **`/*`** на сервере), query **`user_id`** / **`sub`** и опционально **`client_service`** и т.д.

### Примеры `curl`: метки, полный онлайн, фильтр по сервису

**Локально** (прямой доступ к порту presence-ws, по умолчанию **`8765`**):

```bash
# Компактная сводка: total + breakdown[] + by_service{}
curl -sS http://127.0.0.1:8765/summary

# Список меток
curl -sS http://127.0.0.1:8765/services

# Все сессии (= GET /list)
curl -sS http://127.0.0.1:8765/list
curl -sS http://127.0.0.1:8765/online

# Только сессии с меткой client_service=edoc (счётчики и clients по этой метке)
curl -sS 'http://127.0.0.1:8765/online?client_service=edoc'
curl -sS 'http://127.0.0.1:8765/online?svc=edoc'

# Только сессии без метки client_service
curl -sS 'http://127.0.0.1:8765/online?client_service=__none__'
```

**За reverse proxy** (nginx режет префикс и шлёт на тот же upstream; пример пути **`/_presence/`** на сайте Frappe):

```bash
BASE='https://devapp.uzcloud.uz/_presence'

curl -sS "${BASE}/summary"
curl -sS "${BASE}/services"
curl -sS "${BASE}/list"
curl -sS "${BASE}/online"
curl -sS "${BASE}/online?client_service=edoc"
curl -sS "${BASE}/online?client_service=__none__"
```

Подставь свой **`https://<домен>/_presence`** вместо `BASE`, если путь другой.

**Nginx:** если ответ на **`/_presence/online/...`** пустой, а **`/_presence/health`** ок — часто виноват отдельный `location` на **`/_presence/online`**. См. **`deploy/nginx-location-_presence.conf`** и **«Nginx + Frappe»** в **`deploy/HOSTING.md`**: один **`location ^~ /_presence/`** без узкого блока на **`online`**. Для API используй односегментные пути как у health: **`/_presence/summary`**, **`/_presence/services`**, **`/_presence/list`**.

**Если задан `PRESENCE_X_API_TOKEN`** (или `METRICS_AUTH_TOKEN`), добавь заголовок ко всем **`GET`**:

```bash
curl -sS -H "X-Api-Token: $PRESENCE_X_API_TOKEN" http://127.0.0.1:8765/summary
curl -sS -H "X-Api-Token: $PRESENCE_X_API_TOKEN" http://127.0.0.1:8765/services
curl -sS -H "Authorization: Bearer $PRESENCE_X_API_TOKEN" 'https://devapp.uzcloud.uz/_presence/online'
```

(переменная **`BASE`** — из блока «За reverse proxy» выше; для одной команды можно подставить полный URL к **`/list`**, **`/online`**, **`/summary`** или **`/services`**.)

Кратко (то же самое одной строкой для копирования):

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/summary
curl -s http://127.0.0.1:8765/services
curl -s http://127.0.0.1:8765/list
curl -s 'http://127.0.0.1:8765/online?client_service=edoc'
# при PRESENCE_X_API_TOKEN: -H "X-Api-Token: …"
```

### Статистика без `docker exec`

Если порт **8765** с контейнера проброшен на хост (как в `docker-compose`), достаточно **любой** HTTP-клиент с **той машины** — те же URL, что в блоке **«Примеры curl»** выше:

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/summary
curl -s http://127.0.0.1:8765/services
curl -s http://127.0.0.1:8765/list
curl -s 'http://127.0.0.1:8765/online?client_service=edoc'
# при PRESENCE_X_API_TOKEN: -H "X-Api-Token: …"
```

Или, если клонировали репозиторий и Node есть локально (запрос тот же — по умолчанию `http://127.0.0.1:8765/health`):

```bash
cd presence_ws
node health.js
# или
npm run health
```

На удалённом сервере подставьте **хост или IP** и порт, если не `127.0.0.1:8765`:

```bash
curl -s http://ваш-сервер:8765/health
node health.js http://ваш-сервер:8765/health
```

---

### HTTP-клиент статистики (из контейнера)

Скрипт **`health.js`** — один **GET** к `/health`, JSON в stdout (встроенный `http`, без `curl`).

С хоста (имя контейнера из `docker ps` или через compose):

```bash
docker compose -f presence_ws/docker-compose.yml exec presence-ws node health.js
```

```bash
docker exec <контейнер> node health.js
```

По умолчанию запрос идёт на `http://127.0.0.1:8765/health` (порт из `PORT`, если задан). Свой URL:

```bash
docker exec <контейнер> sh -c 'HEALTH_URL=http://127.0.0.1:8765/health node health.js'
docker exec <контейнер> node health.js http://127.0.0.1:8765/health
```

---

Интерактивный CLI: в **`>`** команды **`health`** / **`stats`** и **`online`** ходят в **HTTP** (`/health`, `/online`), не в поток WebSocket — счётчики и список из Redis отдельно от приветствия.

Команды **`docker compose`** нужно выполнять **на хосте**, где установлен Docker, **из каталога с файлом** `docker-compose.yml` (или с явным `-f`). Иначе: `no configuration file provided: not found`.

Из каталога `presence_ws` репозитория:

```bash
cd presence_ws
docker compose exec -it presence-ws node cli.js --url 'ws://127.0.0.1:8765/?user_id=cli'
```

С корня репозитория:

```bash
docker compose -f presence_ws/docker-compose.yml exec -it presence-ws node cli.js --url 'ws://127.0.0.1:8765/?user_id=cli'
```

Без Compose:

```bash
docker exec -it <контейнер_или_ID> node cli.js --url 'ws://127.0.0.1:8765/?user_id=cli'
```

---

## Запуск

Локально: `npm start`. Через Docker — `docker compose up -d` в этом каталоге.
