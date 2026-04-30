# presence-ws

На одном порту: **HTTP** (`/health`, **`/online`**) и **WebSocket** на корне. Порт по умолчанию **8765** (`PORT` в окружении).

**Идентификатор пользователя (opaque) обязателен:** в URL сокета должен быть **`?user_id=...`** или **`?sub=...`** (строка до 512 символов). Без этого параметра сервер **сразу закрывает** соединение (код **1008**). Несколько сокетов с **одинаковым** `user_id` считаются **одним** пользователем: в ответах **`unique_users`**, в Redis — SET `uniq` + refcount.

**Redis:** сессии в **HASH** `sessions`, уникальные `user_id` в **SET** `uniq`, refcount в **HASH** `ref` (см. ключи с hash-tag в `redis-presence.js`). **`GET /health`** и **`GET /online`** возвращают **`connections`** (все сокеты) и **`unique_users`** (разные `user_id`).

В событиях присутствия **нет** счётчиков: **`welcome`** / **`join`** / **`leave`** содержат **`session_id`** (UUID этой сессии, уникальная на каждое подключение), **`clientId`** (то же значение, совместимость), **`user_id`** (opaque пользователя). Полные цифры — только **`GET /health`**, **`GET /online`**, **`info`** / **`stats`** по сокету.

### Переменные окружения (Redis и масштаб)

| Переменная | Назначение |
|------------|------------|
| **`REDIS_URL`** | Например `redis://redis:6379`. Если не задан — Redis не используется. |
| **`REDIS_REQUIRED`** | `1` / `true` — выход при недоступности Redis при старте. |
| **`PRESENCE_TENANT`** | Префикс логического tenant (по умолчанию `default`). |
| **`PRESENCE_SERVICE_ID`** | Идентификатор сервиса (по умолчанию `presence-ws`). |
| **`NODE_INSTANCE_ID`** | Метка ноды в JSON сессии в Redis (по умолчанию `HOSTNAME` или `node`). |

---

## Клиент (подключение к сокету)

Одна команда — подставьте свой хост/порт, если не `127.0.0.1:8765`:

```bash
npx wscat -c "ws://127.0.0.1:8765/?user_id=u-opaque-123"
```

Без **`user_id` / `sub`** подключение будет **отклонено**. **`welcome`**: **`session_id`**, **`clientId`**, **`user_id`**; остальным **`join`** / **`leave`**: то же.

### Команды по WebSocket (info / stats / kick)

Отправьте **текст или JSON** в открытый сокет:

| Действие | Пример | Ответ |
|----------|--------|--------|
| Жив ли сервис, список сессий | текст `info` или `{"cmd":"info"}` | **`clients`**: **`session_id`**, **`user_id`**, … |
| Короткая сводка | текст `stats` или `{"cmd":"stats"}` | `connections`, **`unique_users`**, `uptimeSec`, `alive` |
| Выгнать сессию по UUID | `{"cmd":"kick","session_id":"<uuid>","token":"..."}` (или `id` / `clientId`) | у цели `bye`, вам `kicked` с **`session_id`** |
| Отключить **всех** | `{"cmd":"kickAll","token":"<ADMIN_TOKEN>"}` или `{"cmd":"kick","all":true,"token":"..."}` | всем `bye` с `kickAll` |

Без переменной **`ADMIN_TOKEN`** команды **kick** отклоняются (`error`: kick disabled). Задайте секрет в окружении сервера и перезапустите контейнер.

---

## Сервер: CLI и статистика (через Docker)

Сводка по HTTP и интерактивный CLI — по желанию; **`GET /health`** по-прежнему самый простой мониторинг без JSON-команд в сокете.

### Быстрый онлайн по HTTP (документация / мониторинг)

- **`GET /health`** — `connections` (все сокеты), **`unique_users`**, `connections_local`, `redis`, …
- **`GET /online`** — `connections`, **`unique_users`**, массив **`clients`** (у каждой сессии поле **`user_id`**).

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/online
```

### Статистика без `docker exec`

Если порт **8765** с контейнера проброшен на хост (как в `docker-compose`), достаточно **любой** HTTP-клиент с **той машины**:

```bash
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/online
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
