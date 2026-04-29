"""Whitelist: Desk и внешние клиенты передают опционально ``service`` (идентификатор фронта)."""

from __future__ import annotations

import json

import frappe

from pulse_app.pulse.modules.user_presence import service as pulse_service


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
