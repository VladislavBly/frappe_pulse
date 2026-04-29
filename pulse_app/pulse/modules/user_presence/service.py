"""Присутствие через realtime (publish_realtime), список онлайн, журнал сессий."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

import frappe
from frappe.utils import get_datetime, now_datetime

PROFILE_DOCTYPE = "Pulse User Profile"
EVENT_DOCTYPE = "Pulse Session Event"

ONLINE_WINDOW_SEC = 120
SERVICE_MAX_LEN = 120

REALTIME_EVENT = "pulse_presence"

_SERVICE_SAFE = re.compile(r"^[a-zA-Z0-9._:\-/]+$")


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


def _upsert_profile_last_seen(
	user: str,
	ts: datetime | None = None,
	*,
	service: str | None = None,
) -> dict:
	ts = ts or now_datetime()
	name = frappe.db.get_value(PROFILE_DOCTYPE, {"user": user}, "name")
	if name:
		doc = frappe.get_doc(PROFILE_DOCTYPE, name)
		doc.last_seen_on = ts
		if service is not None:
			doc.presence_source = service
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(
			{
				"doctype": PROFILE_DOCTYPE,
				"user": user,
				"last_seen_on": ts,
				"presence_source": service or "",
			}
		)
		doc.insert(ignore_permissions=True)
	row = row_for_profile(doc)
	_sync_user_pulse_last_seen(user, ts)
	return row


def _sync_user_pulse_last_seen(user: str, ts: datetime | None = None) -> None:
	if "pulse_last_seen_on" not in frappe.db.get_table_columns("User"):
		return
	try:
		frappe.db.set_value("User", user, "pulse_last_seen_on", ts, update_modified=False)
	except Exception:
		pass


def _clear_presence(user: str) -> None:
	name = frappe.db.get_value(PROFILE_DOCTYPE, {"user": user}, "name")
	if name:
		frappe.db.set_value(PROFILE_DOCTYPE, name, "last_seen_on", None, update_modified=False)
		frappe.db.set_value(PROFILE_DOCTYPE, name, "presence_source", None, update_modified=False)
	_sync_user_pulse_last_seen(user, None)


def mark_offline_presence() -> dict:
	user = _require_logged_in()
	_clear_presence(user)
	frappe.publish_realtime(
		REALTIME_EVENT,
		{
			"kind": "offline",
			"user": user,
			"online_users": _online_users_snapshot(),
		},
		after_commit=True,
	)
	return {"offline": True, "user": user}


def row_for_profile(doc) -> dict:
	src = (getattr(doc, "presence_source", None) or "").strip()
	return {
		"user": doc.user,
		"last_seen_on": doc.last_seen_on,
		"name": doc.name,
		"service": src or None,
	}


def _online_users_snapshot() -> list[dict]:
	cutoff = now_datetime() - timedelta(seconds=ONLINE_WINDOW_SEC)
	rows = frappe.get_all(
		PROFILE_DOCTYPE,
		filters={"last_seen_on": (">=", cutoff)},
		fields=["user", "last_seen_on", "name", "presence_source"],
		order_by="last_seen_on desc",
	)
	out = []
	for r in rows:
		src = (r.get("presence_source") or "").strip()
		out.append(
			{
				"user": r.user,
				"last_seen_on": r.last_seen_on,
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
	row = _upsert_profile_last_seen(user, service=norm)
	frappe.publish_realtime(
		REALTIME_EVENT,
		{
			"kind": "presence_update",
			"user": user,
			"last_seen_on": row.get("last_seen_on"),
			"service": row.get("service"),
			"online_users": _online_users_snapshot(),
		},
		after_commit=True,
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
