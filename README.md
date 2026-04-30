# Pulse (`pulse_app`)

Skeleton [Frappe](https://frappeframework.com/) app: **Workspace Pulse**, **`PulseRouter`** under `/api/pulse/*`, HTTP route modules, and **`pulse/modules/<name>/`** with **service** + **controller** layers.

## Layout

- `pulse_app/core/router/` — `PulseRouter`, `router`, `dispatch`
- `pulse_app/http/routes/` — register paths with `router.route(...)` + `bind(Controller, "method")`
- `pulse_app/pulse/modules/sample/` — example `service.py` / `controller.py`
- `pulse_app/pulse/workspace/pulse/pulse.json` — Desk workspace definition
- `pulse_app/pulse/setup/workspace_sidebar.py` — sidebar + app tile sync on install/migrate

## Install

```bash
bench get-app /path/to/frappe_pulse/pulse_app
bench --site yours install-app pulse_app
bench --site yours migrate
```

## API smoke test

Authenticated session cookie as usual for Desk; then:

`GET /api/pulse/health` → JSON envelope `{"data":{"status":"ok","app":"pulse_app"}}`.

## License

MIT — see `pulse_app/hooks.py`.
