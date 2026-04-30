# Pulse (`pulse_app`)

Минимальное [Frappe](https://frappeframework.com/)‑приложение: **воркспейс Pulse** в Desk и **каркас каталогов** под будущий код (роутер, HTTP, модули, realtime, страницы).

## Структура

- `pulse_app/pulse/workspace/pulse/pulse.json` — описание Workspace
- `pulse_app/pulse/setup/workspace_sidebar.py` — синхронизация сайдбара и плитки приложения при install/migrate
- `pulse_app/core/router/` — место под HTTP‑роутинг приложения
- `pulse_app/http/routes/` — регистрация маршрутов (заготовка `bind` в `__init__.py`)
- `pulse_app/pulse/modules/` — фиче‑модули `pulse_app.pulse.modules.<name>`
- `pulse_app/pulse/page/` — стандартные Desk Page (пусто)
- `pulse_app/realtime/` — обработчики Socket.IO (пусто)
- `pulse_app/utils/` — утилиты
- `pulse_app/bin/serializers/` — сериализаторы ответов (пусто)

Целевая платформа и realtime‑слой описаны в [`docs/platform-architecture.md`](docs/platform-architecture.md).

## Установка

```bash
bench get-app /path/to/frappe_pulse/pulse_app
bench --site yours install-app pulse_app
bench --site yours migrate
bench build --app pulse_app
```

## Лицензия

MIT — см. `pulse_app/hooks.py`.
