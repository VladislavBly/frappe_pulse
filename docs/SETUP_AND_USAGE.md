# Pulse: настройка и использование

Пошагово: что нужно на сервере, как установить **pulse_app**, как проверить работу и как вызывать API из Desk и из внешних клиентов.

---

## 1. Что должно быть на сервере

| Компонент | Зачем |
|-----------|--------|
| **Frappe / bench** | Обычная установка сайта. |
| **Redis** | Штатно нужен Frappe; без него не работает realtime (`publish_realtime`). |
| **Процесс Socket.IO (realtime)** | Запускается через `bench start` / supervisor / systemd — как у вашего bench. Без него события **`pulse_presence`** до браузеров не доходят (REST при этом может работать). |
| **Права на сайт** | Установка приложения и миграции — пользователь с доступом к `bench` и сайту (часто **Administrator** внутри Frappe). |

Убедитесь, что сайт уже создан (`bench new-site` или аналог) и вы знаете имя сайта (например `erp.example.com`).

---

## 2. Установка приложения

### 2.1. Положить код приложения в `apps`

Репозиторий содержит каталог приложения **`pulse_app`** (внутри репозитория `frappe_pulse`).

```bash
cd /path/to/frappe-bench/apps
# клонировать репозиторий или скопировать только pulse_app
git clone https://your.git/frappe_pulse.git
ln -sfn frappe_pulse/pulse_app ./pulse_app   # если репозиторий не в apps напрямую
```

Либо скопируйте каталог **`pulse_app`** целиком в `apps/pulse_app`.

### 2.2. Зарегистрировать приложение в bench

```bash
cd /path/to/frappe-bench
bench get-app ./apps/pulse_app
```

Если приложение уже лежит в `apps`, достаточно пути к нему.

### 2.3. Установить на сайт и применить миграции

```bash
bench --site erp.example.com install-app pulse_app
bench --site erp.example.com migrate
```

Подставьте своё имя сайта вместо `erp.example.com`.

Миграции создают DocType **Pulse Session Event**, Custom Field на **User** (**Pulse last seen**, **Pulse presence source**), а также **Workspace «Pulse»** и плитку приложения на экране Desk (через **`add_to_apps_screen`** с **`logo`** и синхронизацию **Desktop Icon**, как в типичной настройке Frappe v15/v16). Устаревший **Pulse User Profile** при **`migrate`** удаляется из БД после переноса данных в **User**.

После установки на экране приложений (**Apps**) должна появиться плитка **Pulse** с переходом на **`/app/pulse`** (ярлыки на журнал сессий и список **User**). Если плитки нет — **`bench build`**, **`migrate`**, **`bench restart`**, **`clear-cache`**, перелогин в Desk.

### 2.4. Перезапуск и кэш (при необходимости)

```bash
bench restart
bench --site erp.example.com clear-cache
```

После изменений в **`public/js`** иногда нужен **`bench build`** или очистка assets — зависит от версии Frappe и режима разработки.

---

## 3. Проверка, что всё завелось

1. Зайдите в **Desk** под пользователем с правами (**Administrator** или роль с доступом к спискам).
2. В поиске типов документов откройте **Pulse Session Event** — записи появятся после вызовов **`record_session_event`** (Login/Logout), если вы их подключите.
3. Откройте **User** — поля **Pulse last seen** и при необходимости **Pulse presence source** (после migrate).
4. Откройте список **User**: при активном Pulse у строк может быть индикатор **Online** / **Away** (после подключения Socket.IO).

Если индикаторов нет — проверьте, что процесс **socketio** / **realtime** запущен и в консоли браузера нет ошибок подключения к WebSocket.

---

## 4. Как это работает для пользователя Desk

Ничего отдельно включать в настройках Pulse не нужно.

**Доступ к странице «Pulse — онлайн», API `pulse_online_dashboard` и REST `GET .../presence/online`** ограничен ролями из **`pulse_online_dashboard_roles`** в `site_config.json` (по умолчанию только **System Manager**). По Socket.IO всем Desk приходит только короткое **`pulse_presence`** (`rev`, пользователь, тип); полные таблицы страница подгружает по HTTP. Пример ролей: `"pulse_online_dashboard_roles": ["System Manager", "Pulse Monitor"]`. После правки **`migrate`** синхронизирует роли на записи **Page pulse-online**.

1. Пользователь входит в **Desk** как обычно.
2. Поднимается **Socket.IO** — скрипт **`pulse_socket.js`** вызывает **`mark_online`** с **`service: "desk"`**.
3. Обновляются поля **Pulse last seen** / **Pulse presence source** у **User**.
4. Остальные пользователи получают события **`pulse_presence`** и при открытом списке User видят обновления индикаторов (после обновления списка / realtime).

При **выходе из Desk** или **закрытии вкладки** вызывается **`mark_offline`** — присутствие снимается, другим уходит **`kind: offline`**.

### 4.1 Redis-присутствие (TTL + heartbeat)

По умолчанию «кто онлайн» считается по полю **User.pulse_last_seen_on** в окне **`pulse_online_window_sec`** (см. `service.ONLINE_WINDOW_SEC` в коде). Для схемы «last seen + TTL без вечного онлайна» включите запись ключей в Redis — тот же экземпляр, что использует `frappe.cache()`:

В **`sites/your-site/site_config.json`**:

| Ключ | Значение |
|------|----------|
| **`pulse_redis_presence`** | `1` — включить ключи `pulse_app:presence:v1:{site}:…` с **SETEX** |
| **`pulse_redis_ttl_seconds`** | TTL ключа в секундах (например `45`; должен быть **больше** интервала heartbeat) |
| **`pulse_heartbeat_ms`** | Интервал вызова **`mark_online`** из Desk в миллисекундах (минимум **5000**, по умолчанию **15000**) |
| **`pulse_online_window_sec`** | Окно для режима **без** Redis (только БД) |
| **`pulse_online_snapshot_mode`** | Откуда список «кто онлайн» на странице Pulse: **`redis_only`** (только активные ключи Redis — клиент недавно слал Pulse **`mark_online`** / heartbeat), **`db_only`** (только поле User в БД), **`merged`** (Redis ∪ БД). Если ключ не задан: при **`pulse_redis_presence`** — **`redis_only`**, иначе **`db_only`**. Это не список сокетов из Node; при необходимости «ровно по Socket.IO» нужны отдельные хуки в **`frappe/realtime`**. |

После правок: **`bench restart`** и **`bench --site … clear-cache`**. В браузере в **`frappe.boot.pulse`** появятся флаги **`redis_presence`**, **`heartbeat_ms`**, **`redis_ttl_sec`**, **`online_window_sec`** — страница **pulse-online** и список онлайн используют **`effective_online_window_sec()`**, чтобы окно совпадало с TTL в Redis-режиме.

Дублирующий метод API: **`pulse_app.api.presence.heartbeat`** — то же, что **`mark_online`** (удобно для внешних клиентов).

---

## 5. Использование через REST (curl / Postman / свой бэкенд)

Нужна **сессия** после логина или **token API** Frappe — как для любого метода API сайта.

### 5.1. Логин и cookie (пример)

```bash
# упрощённо: получите sid после логина через /api/method/login или форму сайта
export SITE="https://erp.example.com"
curl -sS -c cookies.txt -X POST "$SITE/api/method/login" \
  -H 'Content-Type: application/json' \
  -d '{"usr":"Administrator","pwd":"***"}'
```

Дальше подставляйте **`cookies.txt`** в запросы (`-b cookies.txt`).

### 5.2. Отметить онлайн / heartbeat (внешний сервис)

Тот же смысл: **`mark-online`** и **`heartbeat`** (POST).

```bash
curl -sS -X POST "$SITE/api/pulse/presence/mark-online" \
  -b cookies.txt \
  -H 'Content-Type: application/json' \
  -H "X-Frappe-CSRF-Token: YOUR_CSRF" \
  -d '{"service":"my-portal"}'
```

CSRF-токен можно взять из cookie **`csrf_token`** или из ответа boot — как принято в вашей интеграции с Frappe.

Альтернатива без PulseRouter:

```bash
curl -sS -X POST "$SITE/api/method/pulse_app.api.presence.mark_online" \
  -b cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"service":"my-portal"}'
```

### 5.3. Офлайн

```bash
curl -sS -X POST "$SITE/api/pulse/presence/mark-offline" \
  -b cookies.txt \
  -H 'Content-Type: application/json' \
  -H "X-Frappe-CSRF-Token: YOUR_CSRF" \
  -d '{}'
```

### 5.4. Снимок «кто онлайн»

Только пользователи с ролями **`pulse_online_dashboard_roles`** (по умолчанию **System Manager**); иначе **403**.

```bash
curl -sS "$SITE/api/pulse/presence/online" -b cookies.txt
```

Ответ в формате Pulse API: **`{"data": [ ... ]}`** — у каждого пользователя есть **`user`**, **`last_seen_on`**, **`service`**.

### 5.5. История сессий (Login/Logout)

```bash
curl -sS "$SITE/api/pulse/session-events?limit_page_length=20" -b cookies.txt
```

Обычный пользователь видит только **свои** события; **System Manager** может добавить **`&user=user@example.com`**.

---

## 6. Realtime (Socket.IO) для внешнего фронта

Событие **`pulse_presence`** приходит через **тот же Socket.IO-сервер Frappe**, что и у Desk. Подключение зависит от домена и cookie — разбор сценариев и ограничений: **[EXTERNAL_CLIENT.md](EXTERNAL_CLIENT.md)**.

Если WebSocket настроить нельзя, достаточно периодически вызывать **`GET /api/pulse/presence/online`**.

---

## 7. Где смотреть данные в Desk

| Где | Что |
|-----|-----|
| **User** | Поля **Pulse last seen**, **Pulse presence source** (метка клиента из `service`). |
| **Pulse Session Event** | Журнал Login/Logout (если вы начнёте записывать события из хуков — см. архитектуру). |

---

## 8. Частые проблемы

| Симптом | Что проверить |
|---------|----------------|
| Нет индикаторов Online в списке User | Запущен ли **socketio**, есть ли ошибки в консоли браузера; выполнен ли **`migrate`** (поля User / Pulse). |
| Нет realtime-обновлений | **Redis**, процесс **Node realtime**, firewall до порта Socket.IO. |
| Ошибка при **mark-online** | Авторизация (cookie/token), **CSRF** для POST, корректное имя сайта в URL. |
| Поля Pulse не видны в форме User | **`bench migrate`**, **Customize Form** для User — Custom Fields **Pulse last seen** / **Pulse presence source**. |
| Страница «Pulse — онлайн» пустая при включённом Redis | Раньше список брался только из Redis; после обновления приложения список объединяется с БД. Проверьте **`has_pulse_last_seen_on`** в отладке и выполните **`migrate`**. |
| Нужны логи в браузере без правки сервера | В консоли: `localStorage.setItem("pulse_presence_debug","1")`, обновить страницу — в консоли появятся **`[pulse] pulse_online_dashboard`** и **`pulse_presence`**. |

Отладка API: в `site_config.json` можно временно включить **`pulse_api_debug`** (см. [ARCHITECTURE.md](ARCHITECTURE.md)). Для диагностики присутствия добавьте **`pulse_presence_debug`: 1** или включите **`developer_mode`** — в ответе **`pulse_online_dashboard`** появится **`_pulse_debug`**, на странице — жёлтый блок с JSON (после **`bench restart`** / **`clear-cache`**).

---

## 9. Дополнительные документы

| Файл | Содержание |
|------|------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Архитектура, слои, модель данных. |
| [EXTERNAL_CLIENT.md](EXTERNAL_CLIENT.md) | Внешний фронт, REST, WebSocket, поле **`service`**. |
