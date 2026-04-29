<div align="center">

# Pulse

**Real-time user presence for [Frappe](https://frappeframework.com/)**

Know who’s online, where they connected from, and push updates over the same Socket.IO stack Desk already uses — without bolting on a separate presence microservice.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Frappe](https://img.shields.io/badge/Frappe-App-green.svg)](https://github.com/frappe/frappe)

[Русский](README.ru.md) · [Documentation](#documentation)

</div>

---

## Why Pulse?

Frappe gives you great auth and Desk — but not a batteries-included **“who’s online now”** story that works for **Desk**, **custom SPAs**, and **REST** clients under one model.

Pulse adds:

- **Presence** — last seen, online/away semantics (time window–based), optional **client/service tag** (`desk`, `portal`, `mobile`, …).
- **Realtime** — `frappe.publish_realtime` → **`pulse_presence`** events on the standard Frappe **Socket.IO** path (Redis → Node realtime → browsers).
- **Explicit offline** — tab close / logout paths call **`mark_offline`** so others aren’t stuck waiting for a timeout.
- **Session history plumbing** — `Pulse Session Event` (Login/Logout rows); wire your auth hooks when you’re ready.
- **Desk UX** — workspace tile, `/app/pulse`, User list indicators, Custom Field on User for last seen.

Architecture follows the same **router → controllers → services** layering used in larger Frappe apps (clear routes under `/api/pulse/*`, JSON envelopes, testable services).

---

## Features at a glance

| Area | What you get |
|------|----------------|
| **Desk** | Pulse app tile, workspace, Socket.IO connect → `mark_online` with `service: "desk"`, offline on pagehide/logout. |
| **REST** | `POST /api/pulse/presence/mark-online`, `mark-offline`, `GET .../presence/online`, `GET .../session-events`, plus whitelisted methods. |
| **Realtime** | Subscribe to **`pulse_presence`** (payload includes `kind`, `user`, `service`, `online_users`). |
| **Multi-client** | Pass a **`service`** string so you know which frontend reported presence. |
| **Data model** | `Pulse User Profile`, `Pulse Session Event`; optional sync to User custom field `pulse_last_seen_on`. |

---

## Requirements

- **Frappe / bench** site with Redis (standard stack).
- **Socket.IO / realtime** process running (`bench start` / your supervisor setup) — same as any Frappe realtime feature.

---

## Quick install

```bash
cd /path/to/frappe-bench
bench get-app https://github.com/VladislavBly/frappe_pulse.git ./apps/frappe_pulse
# or: bench get-app /absolute/path/to/frappe_pulse/pulse_app

bench --site yoursite.com install-app pulse_app
bench --site yoursite.com migrate
bench restart
```

After migrate you should see the **Pulse** app on the Desk app screen and workspace route **`/app/pulse`**.

If the tile is missing: run **`migrate`** again, **`bench restart`**, **`bench --site yoursite.com clear-cache`**.

---

## Documentation

| Doc | Description |
|-----|-------------|
| **[docs/SETUP_AND_USAGE.md](docs/SETUP_AND_USAGE.md)** | Install, verify Desk, REST examples, troubleshooting. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Layers, data model, API behaviour (also available in Russian in parts). |
| **[docs/EXTERNAL_CLIENT.md](docs/EXTERNAL_CLIENT.md)** | External SPAs: REST auth, `service` field, Socket.IO notes. |

---

## Project layout

```
frappe_pulse/
├── README.md
├── README.ru.md
├── pyproject.toml
├── pulse_app/                 # Frappe app package (install this)
│   ├── hooks.py
│   ├── api/
│   ├── core/router/           # Custom REST router (Werkzeug)
│   ├── http/routes/
│   ├── pulse/
│   │   ├── workspace/         # Desk workspace JSON
│   │   ├── setup/             # Workspace sidebar + desktop icon sync
│   │   └── doctype/
│   └── public/js/             # Desk Socket.IO + User list helpers
└── docs/
```

The installable unit is the **`pulse_app`** directory (standard Frappe layout).

---

## Contributing

Issues and PRs are welcome. Please keep changes focused; match existing patterns (router, controllers, services). Add or update **docs** when behaviour or API surface changes.

---

## License

**MIT** — see [pulse_app/hooks.py](pulse_app/hooks.py) `app_license` and this repository.

---

<p align="center">
  Built for teams who ship on Frappe and still want modern presence semantics.
</p>
