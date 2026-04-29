"""Присутствие через realtime (publish_realtime), список онлайн, журнал сессий.

Источник истины для «кто онлайн» — поля User (pulse_last_seen_on, pulse_presence_source).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

import frappe
from frappe.utils import get_datetime, now_datetime

EVENT_DOCTYPE = "Pulse Session Event"

ONLINE_WINDOW_SEC = 120
SERVICE_MAX_LEN = 120

REALTIME_EVENT = "pulse_presence"

_SERVICE_SAFE = re.compile(r"^[a-zA-Z0-9._:\-/]+$")


def _publish_presence_event(payload: dict) -> None:
	"""Realtime не должен откатывать запись присутствия при недоступном Redis / ошибке publish."""
	try:
		frappe.publish_realtime(REALTIME_EVENT, payload, after_commit=True)
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


def mark_offline_presence() -> dict:
	user = _require_logged_in()
	_clear_presence(user)
	_publish_presence_event(
		{
			"kind": "offline",
			"user": user,
			"online_users": _online_users_snapshot(),
		}
	)
	return {"offline": True, "user": user}


def _online_users_snapshot() -> list[dict]:
	if "pulse_last_seen_on" not in _user_presence_columns():
		return []

	cutoff = now_datetime() - timedelta(seconds=ONLINE_WINDOW_SEC)
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


def mark_online_presence(*, service: str | None = None) -> dict:
	"""
	Обновить присутствие и разослать realtime.

	:param service: необязательный ярлык клиента (desk, portal-spa, mobile, …).
	"""
	user = _require_logged_in()
	norm = normalize_presence_service(service)
	row = _touch_presence_last_seen(user, service=norm)
	_publish_presence_event(
		{
			"kind": "presence_update",
			"user": user,
			"last_seen_on": row.get("last_seen_on"),
			"service": row.get("service"),
			"online_users": _online_users_snapshot(),
		}
	)
	return {"profile": row, "updated_at": now_datetime()}


def list_online_users() -> list[dict]:
	_require_logged_in()
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
