"""Присутствие через realtime (канал Redis ``events`` → Socket.IO), список онлайн, журнал сессий.

Список «кто онлайн» всегда по счётчикам Socket.IO в Redis (``pulse_app/realtime/handlers.js``).
Поля ``User.pulse_last_seen_on`` / ``pulse_presence_source`` обновляются через ``mark_online`` отдельно.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

import frappe
from frappe.utils import get_datetime, now_datetime

EVENT_DOCTYPE = "Pulse Session Event"

ONLINE_WINDOW_SEC = 120
ONLINE_LIST_SOURCE = "socket"
SERVICE_MAX_LEN = 120
REALTIME_EVENT = "pulse_presence"
_SERVICE_SAFE = re.compile(r"^[a-zA-Z0-9._:\-/]+$")


def _presence_rev_cache_key() -> str:
	return f"pulse_app:presence_rev:{frappe.local.site}"


def bump_presence_revision() -> int:
	"""Монотонный счётчик для сокета: клиенты по rev понимают, что снимок на сервере сменился."""
	key = _presence_rev_cache_key()
	cache = frappe.cache()
	try:
		val = cache.incr(key)
		if val is not None:
			return int(val)
	except Exception:
		pass
	try:
		cur = int(cache.get(key) or 0)
		nxt = cur + 1
		cache.set(key, nxt)
		return nxt
	except Exception:
		return int(now_datetime().timestamp())


def current_presence_revision() -> int | None:
	try:
		raw = frappe.cache().get(_presence_rev_cache_key())
		if raw is None:
			return None
		return int(raw)
	except Exception:
		return None


def _db_online_window_sec() -> int:
	"""Окно для выборки онлайн из БД (без Redis или как дополнение к Redis)."""
	try:
		return int(frappe.conf.get("pulse_online_window_sec") or ONLINE_WINDOW_SEC)
	except Exception:
		return ONLINE_WINDOW_SEC


def user_list_online_window_sec() -> int:
	"""Секунды для индикатора Online/Away в списке User (по ``pulse_last_seen_on``)."""
	return _db_online_window_sec()


def diagnostics_presence() -> dict:
	"""Сводка для отладки пустого списка онлайн / журнала (см. pulse_presence_debug)."""
	cols = _user_presence_columns()
	has_ls = "pulse_last_seen_on" in cols
	has_src = "pulse_presence_source" in cols
	db_rows = _online_users_snapshot_db()
	dt_exists = bool(frappe.db.exists("DocType", EVENT_DOCTYPE))
	snapshot_err = None
	socket_conn_n = 0
	try:
		from pulse_app.pulse.modules.user_presence import socket_channel

		socket_conn_n = len(socket_channel.iter_socket_connected_usernames())
	except Exception:
		pass
	try:
		snapshot_len = len(_online_users_snapshot())
	except Exception:
		snapshot_len = -1
		snapshot_err = frappe.get_traceback()[-1200:]
	return {
		"online_list_source": ONLINE_LIST_SOURCE,
		"socket_connected_users_count": socket_conn_n,
		"has_pulse_last_seen_on": has_ls,
		"has_pulse_presence_source": has_src,
		"pulse_session_event_doctype": dt_exists,
		"session_events_total": frappe.db.count(EVENT_DOCTYPE) if dt_exists else None,
		"db_online_count": len(db_rows),
		"db_window_sec": _db_online_window_sec(),
		"snapshot_online_count": snapshot_len,
		"snapshot_diag_error": snapshot_err,
	}


def _publish_presence_event(payload: dict) -> None:
	"""Только короткий сигнал по штатному Socket.IO Frappe; полные данные — через HTTP API."""
	msg = dict(payload)
	msg["rev"] = bump_presence_revision()
	try:
		frappe.publish_realtime(REALTIME_EVENT, msg, after_commit=True)
	except Exception:
		frappe.log_error(title="Pulse: publish_realtime failed", message=frappe.get_traceback())


def _user_presence_columns() -> set[str]:
	return set(frappe.db.get_table_columns("User"))


def _require_logged_in() -> str:
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(frappe._("Not authenticated"), frappe.AuthenticationError)
	return user


def _get_client_ip() -> str | None:
	try:
		req = frappe.local.request
	except Exception:
		return None
	if not req:
		return None
	xff = (req.headers.get("X-Forwarded-For") or "").strip()
	if xff:
		return xff.split(",")[0].strip()
	return (req.remote_addr or "").strip() or None


def normalize_presence_service(service: str | None) -> str | None:
	"""Короткий идентификатор клиента для REST/realtime (латиница, цифры, ._:-/)."""
	if service is None:
		return None
	s = (service or "").strip()
	if not s:
		return None
	if len(s) > SERVICE_MAX_LEN:
		s = s[:SERVICE_MAX_LEN]
	if not _SERVICE_SAFE.match(s):
		frappe.throw(
			frappe._("Invalid service: use letters, digits and ._:-/ only (max {0} chars)").format(SERVICE_MAX_LEN),
			frappe.ValidationError,
		)
	return s


def row_from_user(user: str, last_seen_on, presence_source: str | None = None) -> dict:
	"""Формат как у прежнего «profile» для API/realtime (name = имя пользователя User)."""
	src = (presence_source or "").strip() if presence_source is not None else ""
	if not src and "pulse_presence_source" in _user_presence_columns():
		src = (frappe.db.get_value("User", user, "pulse_presence_source") or "").strip()
	return {
		"user": user,
		"last_seen_on": last_seen_on,
		"name": user,
		"service": src or None,
	}


def _touch_presence_last_seen(
	user: str,
	ts: datetime | None = None,
	*,
	service: str | None = None,
) -> dict:
	ts = ts or now_datetime()
	cols = _user_presence_columns()
	if "pulse_last_seen_on" not in cols:
		return row_from_user(user, ts, service or "")

	values: dict = {"pulse_last_seen_on": ts}
	if service is not None and "pulse_presence_source" in cols:
		values["pulse_presence_source"] = service or ""

	frappe.db.set_value("User", user, values, update_modified=False)
	src_out: str | None = service
	if src_out is None and "pulse_presence_source" in cols:
		src_out = frappe.db.get_value("User", user, "pulse_presence_source")
	return row_from_user(user, ts, src_out)


def _clear_presence(user: str) -> None:
	cols = _user_presence_columns()
	if "pulse_last_seen_on" not in cols:
		return
	values: dict = {"pulse_last_seen_on": None}
	if "pulse_presence_source" in cols:
		values["pulse_presence_source"] = None
	frappe.db.set_value("User", user, values, update_modified=False)


def effective_online_window_sec() -> int:
	"""Окно для подписи UI: список онлайн по сокетам — без временного окна (0)."""
	return 0


def mark_offline_presence() -> dict:
	user = _require_logged_in()
	_clear_presence(user)
	_publish_presence_event(
		{
			"kind": "offline",
			"user": user,
		}
	)
	return {"offline": True, "user": user}


def _online_users_snapshot_db() -> list[dict]:
	if "pulse_last_seen_on" not in _user_presence_columns():
		return []

	cutoff = now_datetime() - timedelta(seconds=_db_online_window_sec())
	fields = ["name", "pulse_last_seen_on"]
	if "pulse_presence_source" in _user_presence_columns():
		fields.append("pulse_presence_source")

	rows = frappe.get_all(
		"User",
		filters={
			"enabled": 1,
			"pulse_last_seen_on": (">=", cutoff),
		},
		fields=fields,
		order_by="pulse_last_seen_on desc",
	)
	out = []
	for r in rows:
		src = ""
		if "pulse_presence_source" in r:
			src = (r.get("pulse_presence_source") or "").strip()
		out.append(
			{
				"user": r.name,
				"last_seen_on": r.pulse_last_seen_on,
				"service": src or None,
			}
		)
	return out


def _online_users_snapshot_socket() -> list[dict]:
	from pulse_app.pulse.modules.user_presence import socket_channel

	names = socket_channel.iter_socket_connected_usernames()
	if not names:
		return []
	enabled_rows = frappe.get_all(
		"User",
		filters={"enabled": 1, "name": ("in", names)},
		fields=["name", "pulse_last_seen_on", "pulse_presence_source"]
		if "pulse_presence_source" in _user_presence_columns()
		else ["name", "pulse_last_seen_on"],
	)
	by_name = {r.name: r for r in enabled_rows}
	ts_now = now_datetime()
	out = []
	for u in sorted(by_name.keys()):
		r = by_name[u]
		src = ""
		if "pulse_presence_source" in r:
			src = (r.get("pulse_presence_source") or "").strip()
		ls = r.get("pulse_last_seen_on") or ts_now
		out.append({"user": u, "last_seen_on": ls, "service": src or None})
	return out


def _online_users_snapshot() -> list[dict]:
	try:
		return _online_users_snapshot_socket()
	except Exception:
		frappe.log_error(title="Pulse: socket snapshot failed", message=frappe.get_traceback())
		return []


def mark_online_presence(*, service: str | None = None) -> dict:
	"""
	Обновить присутствие и разослать realtime.

	:param service: необязательный ярлык клиента (desk, portal-spa, mobile, …).
	"""
	user = _require_logged_in()
	norm = normalize_presence_service(service)
	row = _touch_presence_last_seen(user, service=norm)
	if frappe.conf.get("pulse_presence_debug"):
		frappe.logger("pulse_presence", allow_site=True).info(
			"pulse mark_online user=%s service=%s",
			user,
			norm or "",
		)
	_publish_presence_event(
		{
			"kind": "presence_update",
			"user": user,
			"service": row.get("service"),
		}
	)
	return {"profile": row, "updated_at": now_datetime()}


def get_online_users_snapshot_internal() -> list[dict]:
	"""Снимок «кто онлайн» без проверки сессии (сборка ответа pulse_online_dashboard на сервере)."""
	return _online_users_snapshot()


def list_online_users() -> list[dict]:
	user = _require_logged_in()
	from pulse_app.pulse.dashboard_access import user_can_view_pulse_online_dashboard

	if not user_can_view_pulse_online_dashboard(user):
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)
	return _online_users_snapshot()


def list_session_events(
	*,
	user: str | None = None,
	limit_start: int = 0,
	limit_page_length: int = 50,
) -> tuple[list[dict], int]:
	filters: dict = {}
	if user:
		filters["user"] = user

	total = frappe.db.count(EVENT_DOCTYPE, filters=filters)
	rows = frappe.get_all(
		EVENT_DOCTYPE,
		filters=filters or None,
		fields=["name", "user", "event_type", "occurred_on", "ip_address", "user_agent"],
		order_by="occurred_on desc",
		start=limit_start,
		page_length=limit_page_length,
	)
	out = [
		{
			"id": r.name,
			"user": r.user,
			"event_type": r.event_type,
			"occurred_on": get_datetime(r.occurred_on).isoformat() if r.occurred_on else None,
			"ip_address": r.ip_address,
			"user_agent": r.user_agent,
		}
		for r in rows
	]
	return out, int(total)


def record_session_event(event_type: str, *, for_user: str | None = None) -> dict:
	u = for_user or _require_logged_in()
	if event_type not in ("Login", "Logout"):
		frappe.throw(frappe._("Invalid event_type"), frappe.ValidationError)

	ua = ""
	try:
		if frappe.local.request:
			ua = (frappe.local.request.headers.get("User-Agent") or "")[:240]
	except Exception:
		ua = ""

	doc = frappe.get_doc(
		{
			"doctype": EVENT_DOCTYPE,
			"user": u,
			"event_type": event_type,
			"occurred_on": now_datetime(),
			"ip_address": (_get_client_ip() or "")[:140],
			"user_agent": ua,
		}
	)
	doc.insert(ignore_permissions=True)
	return {"id": doc.name, "event_type": doc.event_type, "occurred_on": doc.occurred_on}
