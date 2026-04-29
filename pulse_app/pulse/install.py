"""Install / migrate hooks."""

from __future__ import annotations

import frappe

from pulse_app.pulse.setup.workspace_sidebar import ensure_sidebar


def ensure_pulse_user_custom_fields():
	"""Поле User.pulse_last_seen_on — для списка и формы User в Desk."""
	if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "pulse_last_seen_on"}):
		return

	try:
		doc = frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": "User",
				"fieldname": "pulse_last_seen_on",
				"label": "Pulse last seen",
				"fieldtype": "Datetime",
				"insert_after": "last_login",
				"read_only": 1,
				"description": "Updated when the user connects to Desk with Pulse (Socket.IO). Shown in User list as Online/Away.",
			}
		)
		doc.insert()
	except Exception:
		frappe.log_error(
			title="Pulse: Custom Field User.pulse_last_seen_on",
			message=frappe.get_traceback(),
		)


def after_install():
	ensure_pulse_user_custom_fields()
	ensure_sidebar()


def after_migrate():
	ensure_pulse_user_custom_fields()
	ensure_sidebar()
