"""Whitelist: Desk и внешние клиенты передают опционально ``service`` (идентификатор фронта)."""

from __future__ import annotations

import json

import frappe

from pulse_app.pulse.modules.user_presence import service as pulse_service

_ONLINE_WINDOW_SEC = getattr(pulse_service, "ONLINE_WINDOW_SEC", 120)


def _session_events_for_pulse_page(limit: int = 40) -> list[dict]:
	"""Login/Logout из Pulse Session Event; не‑админы видят только свои строки."""
	from frappe.utils import cint, get_datetime

	user = frappe.session.user
	if not user or user == "Guest":
		return []

	limit = min(max(cint(limit) or 40, 1), 100)
	if not frappe.db.exists("DocType", "Pulse Session Event"):
		return []

	is_mgr = "System Manager" in frappe.get_roles(user)
	filters = None if is_mgr else {"user": user}

	rows = frappe.get_all(
		"Pulse Session Event",
		filters=filters,
		fields=["name", "user", "event_type", "occurred_on", "ip_address"],
		order_by="occurred_on desc",
		limit_page_length=limit,
		ignore_permissions=True,
	)
	out = []
	for r in rows:
		oc = r.get("occurred_on")
		out.append(
			{
				"id": r.get("name"),
				"user": r.get("user"),
				"event_type": r.get("event_type"),
				"occurred_on": get_datetime(oc).isoformat() if oc else None,
				"ip_address": ((r.get("ip_address") or "")[:80]),
			}
		)
	return out


def _extract_service_from_request():
	"""GET/POST form, JSON body или frappe.call args."""
	svc = frappe.form_dict.get("service")
	if svc not in (None, ""):
		return svc
	try:
		raw = frappe.request.get_data(as_text=True) if frappe.request else ""
		if raw and raw.strip():
			body = json.loads(raw)
			if isinstance(body, dict) and body.get("service") is not None:
				return body.get("service")
	except Exception:
		pass
	return None


@frappe.whitelist()
def mark_online(service=None):
	"""
	Обновить присутствие и разослать ``pulse_presence``.

	Параметр ``service``: строка в теле JSON, в query или в ``args`` frappe.call
	(например ``desk``, ``portal-react``, ``mobile-ios``).
	"""
	svc = service if service not in (None, "") else _extract_service_from_request()
	return pulse_service.mark_online_presence(service=svc)


@frappe.whitelist()
def mark_offline():
	return pulse_service.mark_offline_presence()


@frappe.whitelist()
def desk_pulse_snapshot(users=None):
	"""
	Для Desk: вернуть ``pulse_last_seen_on`` / ``pulse_presence_source`` по списку имён User.

	``users`` — JSON-массив строк или одиночная строка (frappe.call из JS).
	Ограничение: не более 300 имён за запрос.
	"""
	if frappe.session.user == "Guest":
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)

	if users in (None, ""):
		return []

	if isinstance(users, (list, tuple)):
		raw = list(users)
	elif isinstance(users, str):
		try:
			raw = json.loads(users)
		except json.JSONDecodeError:
			raw = [users]
	else:
		frappe.throw(frappe._("Invalid users"))

	if not isinstance(raw, (list, tuple)):
		raw = [raw]

	names = [u for u in raw if u and isinstance(u, str)][:300]
	if not names:
		return []

	cols = frappe.db.get_table_columns("User")
	fields = ["name"]
	if "pulse_last_seen_on" in cols:
		fields.append("pulse_last_seen_on")
	if "pulse_presence_source" in cols:
		fields.append("pulse_presence_source")

	return frappe.get_all("User", filters={"name": ("in", names)}, fields=fields)


@frappe.whitelist()
def pulse_online_dashboard():
	"""
	Страница «Pulse — онлайн»: список пользователей в окне онлайна + метаданные для UI.
	"""
	if frappe.session.user == "Guest":
		frappe.throw(frappe._("Not permitted"), frappe.PermissionError)

	from frappe.utils import now_datetime

	rows = pulse_service.list_online_users()
	out = []
	for row in rows:
		ls = row.get("last_seen_on")
		out.append(
			{
				"user": row.get("user"),
				"last_seen_on": ls.isoformat() if hasattr(ls, "isoformat") else ls,
				"service": row.get("service"),
			}
		)

	return {
		"online_users": out,
		"online_window_sec": _ONLINE_WINDOW_SEC,
		"server_time": now_datetime().isoformat(),
		"current_user": frappe.session.user,
		"session_events": _session_events_for_pulse_page(40),
		"session_events_scope": "all"
		if ("System Manager" in frappe.get_roles(frappe.session.user))
		else "mine",
	}
