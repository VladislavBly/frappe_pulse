<div align="center">

# Pulse

**Онлайн-присутствие пользователей для [Frappe](https://frappeframework.com/)**

Понимайте, кто сейчас в сети, откуда пришло подключение, и рассылайте обновления через тот же стек **Socket.IO**, что уже использует Desk — без отдельного микросервиса присутствия.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Frappe](https://img.shields.io/badge/Frappe-App-green.svg)](https://github.com/frappe/frappe)

[English README](README.md) · [Документация](#документация)

</div>

---

## Зачем Pulse

У Frappe сильная авторизация и Desk, но готовой истории **«кто сейчас онлайн»** для **Desk**, **кастомных SPA** и **REST** под одной моделью из коробки нет.

Pulse добавляет:

- **Присутствие** — last seen, онлайн/away по окну времени, опциональный тег **клиента/сервиса** (`desk`, `portal`, `mobile`, …).
- **Realtime** — `frappe.publish_realtime` → событие **`pulse_presence`** по штатному пути Frappe **Socket.IO** (Redis → Node realtime → браузеры).
- **Явный офлайн** — закрытие вкладки / выход вызывают **`mark_offline`**, чтобы не ждать таймаута.
- **Заготовка истории сессий** — DocType `Pulse Session Event` (Login/Logout); хуки авторизации подключаете при необходимости.
- **Интеграция с Desk** — плитка приложения, `/app/pulse`, индикаторы в списке User, Custom Field на User для last seen.

Архитектура в духе крупных Frappe-приложений: **router → controllers → services**, явные маршруты под **`/api/pulse/*`**, JSON-ответы, тестируемые сервисы.

---

## Возможности

| Область | Что даёт |
|---------|----------|
| **Desk** | Плитка Pulse, workspace, при connect Socket.IO → `mark_online` с `service: "desk"`, офлайн при pagehide/logout. |
| **REST** | `POST .../mark-online`, `mark-offline`, `GET .../presence/online`, `GET .../session-events`, whitelist-методы. |
| **Realtime** | Подписка на **`pulse_presence`** (payload: `kind`, `user`, `service`, `online_users`). |
| **Несколько фронтов** | Поле **`service`** — откуда пришло присутствие. |
| **Данные** | `Pulse User Profile`, `Pulse Session Event`; опционально синхронизация в Custom Field User `pulse_last_seen_on`. |

---

## Требования

- Сайт на **Frappe / bench** с **Redis** (типовой стек).
- Запущенный процесс **Socket.IO / realtime** — как для любого realtime в Frappe.

---

## Быстрая установка

```bash
cd /path/to/frappe-bench
bench get-app https://github.com/VladislavBly/frappe_pulse.git ./apps/frappe_pulse
# или: bench get-app /абсолютный/путь/frappe_pulse/pulse_app

bench --site yoursite.com install-app pulse_app
bench --site yoursite.com migrate
bench restart
```

После migrate на экране приложений Desk должна появиться плитка **Pulse** и маршрут **`/app/pulse`**.

Если плитки нет: повторите **`migrate`**, **`bench restart`**, **`bench --site … clear-cache`**.

---

## Документация

| Файл | Описание |
|------|----------|
| **[docs/SETUP_AND_USAGE.md](docs/SETUP_AND_USAGE.md)** | Установка, проверка Desk, примеры REST, типичные проблемы. |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Слои, модель данных, API (часть текста на русском). |
| **[docs/EXTERNAL_CLIENT.md](docs/EXTERNAL_CLIENT.md)** | Внешние SPA: REST, поле `service`, Socket.IO. |

Полный **README на английском** (основной для репозитория): [README.md](README.md).

---

## Структура репозитория

```
frappe_pulse/
├── README.md              # основной (EN)
├── README.ru.md           # этот файл
├── pyproject.toml
├── pulse_app/             # устанавливаемое Frappe-приложение
│   ├── hooks.py
│   ├── api/
│   ├── core/router/
│   ├── http/routes/
│   ├── pulse/
│   │   ├── workspace/
│   │   ├── setup/
│   │   └── doctype/
│   └── public/js/
└── docs/
```

В **`bench get-app`** указывают каталог **`pulse_app`** (или репозиторий, если он свёрнут в один app).

---

## Участие в проекте

Issues и PR приветствуются. Держите изменения сфокусированными; при смене поведения или API обновляйте **docs**.

---

## Лицензия

**MIT** — см. [pulse_app/hooks.py](pulse_app/hooks.py) и корень репозитория.

---

<p align="center">
  Для команд на Frappe, которым нужно современное присутствие без лишней инфраструктуры.
</p>
