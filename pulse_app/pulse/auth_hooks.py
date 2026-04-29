"""Хуки Frappe: вход / выход → журнал Pulse Session Event + присутствие User."""

from __future__ import annotations

import frappe

from pulse_app.pulse.modules.user_presence import service as pulse_svc


def on_login(login_manager=None):
	"""После успешного входа: событие Login + сразу desk-присутствие (до загрузки JS)."""
	if frappe.session.user == "Guest":
		return
	try:
		pulse_svc.record_session_event("Login")
	except Exception:
		frappe.log_error(title="Pulse: record_session_event Login", message=frappe.get_traceback())
	try:
		pulse_svc.mark_online_presence(service="desk")
	except Exception:
		frappe.log_error(title="Pulse: mark_online_presence on_login", message=frappe.get_traceback())


def on_logout(login_manager=None):
	"""До завершения сессии: событие Logout + offline присутствие (дублирует beacon при наличии)."""
	if frappe.session.user == "Guest":
		return
	try:
		pulse_svc.record_session_event("Logout")
	except Exception:
		frappe.log_error(title="Pulse: record_session_event Logout", message=frappe.get_traceback())
	try:
		pulse_svc.mark_offline_presence()
	except Exception:
		frappe.log_error(title="Pulse: mark_offline_presence on_logout", message=frappe.get_traceback())
