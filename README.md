# Pulse (`pulse_app`)

Frappe-приложение в том же стиле, что **`edoc_app`** (`edoc_frappe_app/edoc_app`): **Workspace Pulse** в Desk и **HTTP API** через архитектурный слой **`Router`** на **Werkzeug `Map`/`Rule`** (singleton **`router`**).

## Структура (как в edoc_app)

- `pulse_app/core/router/` — класс `Router`, экземпляр `router`, `dispatch`, `route(...)`
- `pulse_app/http/routes/` — регистрация путей через `@router.route(...)` + `bind(Controller, "method")`
- `pulse_app/http/request_helpers.py` — разбор JSON/query (как в edoc)
- `pulse_app/bin/serializers/http_response.py` — `json_response` / `json_error`
- `pulse_app/utils/api_routes.py` — импорт модулей маршрутов, `router.build()`, хук `before_request` → `/api/pulse/*`
- `pulse_app/pulse/modules/<name>/` — `service.py` + `controller.py`
- `pulse_app/pulse/workspace/pulse/pulse.json` — Workspace
- `pulse_app/pulse/setup/workspace_sidebar.py` — сайдбар и плитка приложения

Целевая платформа (Frappe + отдельный WS-слой и т.д.) — [`docs/platform-architecture.md`](docs/platform-architecture.md).

## Установка

```bash
bench get-app /path/to/frappe_pulse/pulse_app
bench --site yours install-app pulse_app
bench --site yours migrate
bench build --app pulse_app
```

## Проверка API

С сессией Desk (cookie):

`GET /api/pulse/health` → `{"data":{"status":"ok","app":"pulse_app"}}`

## Лицензия

MIT — см. `pulse_app/hooks.py`.
