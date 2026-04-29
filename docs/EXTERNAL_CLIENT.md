# Внешний фронтенд: REST + realtime (`pulse_presence`)

Приложение **pulse_app** позволяет любому клиенту с **валидной сессией Frappe** (cookie после логина или **token** API) помечать себя онлайн и указывать **идентификатор сервиса**, не только Desk.

---

## 1. Аутентификация

Тот же механизм, что у остального API сайта:

- **Cookie-сессия** после `POST /api/method/login` (или формы входа на сайте).
- Или **`Authorization: token <api_key>:<api_secret>`** / **`Authorization: Bearer ...`** — как настроено у вашего сайта Frappe.

Без аутентификации `mark-online` / `mark-offline` вернут ошибку.

---

## 2. REST: онлайн / офлайн

Базовый префикс (через **PulseRouter**): **`/api/pulse`**.

| Метод | Путь | Тело (JSON) | Описание |
|-------|------|-------------|----------|
| `POST` | `/api/pulse/presence/mark-online` | `{ "service": "portal-spa" }` | Поле **`service` необязательно**. Строка из латиницы, цифр и символов `._:-/` (до 120 символов). Пример: `desk`, `portal-react`, `partner-api`. |
| `POST` | `/api/pulse/presence/mark-offline` | `{}` | Снять присутствие, разослать `kind: offline`. |
| `GET` | `/api/pulse/presence/online` | — | Снимок текущих онлайн-пользователей с полем **`service`** на каждой строке. |

Альтернатива совместимости с вызовами Frappe:

- `POST /api/method/pulse_app.api.presence.mark_online` с JSON `{ "service": "my-app" }` или query `?service=my-app`.

Пример **curl** (сессия cookie):

```bash
curl -sS -X POST 'https://YOUR_SITE/api/pulse/presence/mark-online' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: sid=...' \
  -d '{"service":"portal-spa"}'
```

Значение **`service`** сохраняется в **`User.pulse_presence_source`** и попадает в payload realtime (ниже).

---

## 3. Канал realtime: событие `pulse_presence`

Раздача идёт через **штатный стек Frappe**: Redis → процесс **Node (Socket.IO)** → браузеры / клиенты.

Имя события: **`pulse_presence`**.

Типичные полезные нагрузки:

```json
{
  "kind": "presence_update",
  "user": "user@example.com",
  "last_seen_on": "...",
  "service": "portal-spa",
  "online_users": [
    { "user": "a@x.com", "last_seen_on": "...", "service": "desk" },
    { "user": "b@x.com", "last_seen_on": "...", "service": "mobile-ios" }
  ]
}
```

```json
{
  "kind": "offline",
  "user": "user@example.com",
  "online_users": [ ... ]
}
```

Подписчики Desk уже слушают в **`pulse_socket.js`**. Внешнему SPA нужно подключиться к **тому же Socket.IO-серверу**, что и сайт (с учётом multitenancy: **namespace `/<sitename>`** в актуальных версиях Frappe).

Минимальный паттерн (браузер, после авторизации на том же origin):

```javascript
import { io } from "socket.io-client";

const socket = io(`${window.location.origin}/${frappe?.boot?.sitename ?? "sitename"}`, {
  withCredentials: true,
});

socket.on("pulse_presence", (payload) => {
  console.log(payload.kind, payload.user, payload.service, payload.online_users);
});
```

Точный URL и опции зависят от версии Frappe и от того, открыт ли SPA на том же домене (cookie) или на другом (тогда нужны CORS, отдельная выдача токена для Socket.IO — это инфраструктурная настройка сайта).

Официальная справка: [Realtime (socket.io)](https://docs.frappe.io/framework/user/en/api/realtime).

### Подключить внешний сервис к тому же WebSocket — можно

Pulse **не создаёт отдельный** сервер сокетов: события идут через **тот же процесс realtime Frappe** (Node + Socket.IO), что использует Desk. Любой клиент, который **успешно проходит ту же проверку подключения**, что и браузер Desk, может подписаться на **`pulse_presence`** — это и есть «подключение внешнего сервиса к вебсокету».

Практические варианты:

| Сценарий | Идея |
|----------|------|
| **SPA на том же домене**, что и сайт Frappe | Обычно достаточно `io(origin + '/' + sitename, { withCredentials: true })` после логина — cookie сессии (`sid`) уходит на Socket.IO как у Desk. |
| **SPA на другом домене** | Cookie часто не передаются cross-origin. Нужно либо **прокси** с тем же host (nginx → Desk), либо настройка **CORS / credentials** для процесса Socket.IO на bench, либо **BFF** на своём бэкенде, который держит сессию и не отдаёт сокет напрямую в браузер с чужого origin — это уже инфраструктура, не Pulse. |
| **Мобильное приложение / backend-сервис** | После логина через API сохранить cookie/`sid` или то, что ваш стек использует для API, и подключить **`socket.io-client`** (Node, Dart, Swift и т.д.), передав сессию так же, как это делает клиент Frappe при handshake (часто cookie в заголовках или параметрах — см. исходники **`frappe/realtime`** и версию bench). |
| **Без WebSocket** | Внешний сервис может работать **только через REST** (`mark-online`, `GET .../presence/online`) и периодически опрашивать список — realtime при этом не обязателен. |

Итого: **отдельный «канал только для внешних» Pulse не вводит** — используется общий Socket.IO Frappe. Чтобы внешний фронт или сервис реально получал события в реальном времени, его нужно **подключить к этому же серверу** с валидной для сайта сессией; ограничения те же, что у любого не-Desk клиента Frappe realtime.

---

## 4. Поведение поля `service`

- При каждом успешном **`mark-online`** обновляются **last seen** и **presence_source** (если передан непустой `service`).
- Если **`mark-online`** вызван **без** `service`, при **уже существующей** записи профиля поле источника **не затирается** (остаётся предыдущее значение).
- Новый профиль без `service` получает пустой источник до первого вызова с явным `service`.

---

## 5. Ограничения

- Несколько вкладок / клиентов с разными `service`: в БД хранится **один** last_seen и один **presence_source** на пользователя (последний успешный `mark-online` определяет источник).
- Полноценная модель «несколько одновременных сессий по сервисам» потребует отдельной таблицы сессий — сейчас не реализовано.
