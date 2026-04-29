"""Install / migrate hooks."""

from __future__ import annotations

import frappe
from frappe.utils import get_datetime

from pulse_app.pulse.setup.workspace_sidebar import (
	ensure_sidebar,
	sync_pulse_workspace_shortcuts_from_app,
	upgrade_pulse_workspace_if_legacy,
)


def ensure_pulse_user_custom_fields():
	"""Расширение User: pulse_last_seen_on, pulse_presence_source — без отдельного профиля Pulse."""
	_ensure_user_cf_pulse_last_seen()
	_ensure_user_cf_pulse_presence_source()


def _ensure_user_cf_pulse_last_seen():
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
				"in_list_view": 1,
				"description": "Updated when the user connects with Pulse (Socket.IO / mark_online). Shown in User list as Online/Away.",
			}
		)
		doc.flags.ignore_validate = True
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="Pulse: Custom Field User.pulse_last_seen_on",
			message=frappe.get_traceback(),
		)


def _ensure_user_cf_pulse_presence_source():
	if frappe.db.exists("Custom Field", {"dt": "User", "fieldname": "pulse_presence_source"}):
		return
	if "pulse_last_seen_on" not in frappe.db.get_table_columns("User"):
		return
	try:
		doc = frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": "User",
				"fieldname": "pulse_presence_source",
				"label": "Pulse presence source",
				"fieldtype": "Data",
				"insert_after": "pulse_last_seen_on",
				"read_only": 1,
				"description": "Client label from mark_online (e.g. desk, portal-spa).",
			}
		)
		doc.flags.ignore_validate = True
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="Pulse: Custom Field User.pulse_presence_source",
			message=frappe.get_traceback(),
		)


def after_install():
	ensure_pulse_user_custom_fields()
	ensure_pulse_online_page()
	sync_pulse_workspace_shortcuts_from_app()
	ensure_sidebar()


def after_migrate():
	ensure_pulse_user_custom_fields()
	ensure_pulse_online_page()
	_ensure_pulse_user_field_in_list_view()
	_hide_pulse_columns_from_user_list()
	_sync_legacy_pulse_profile_into_user()
	_remove_pulse_user_profile_doctype()
	upgrade_pulse_workspace_if_legacy()
	sync_pulse_workspace_shortcuts_from_app()
	ensure_sidebar()


def ensure_pulse_online_page():
	"""Desk Page pulse-online — кастомная страница; JS подключается через hooks page_js."""
	if frappe.db.exists("Page", "pulse-online"):
		# Раньше было standard=Yes без fixture в репозитории → Desk показывал «страница не найдена».
		std = frappe.db.get_value("Page", "pulse-online", "standard")
		if std == "Yes":
			try:
				frappe.db.set_value("Page", "pulse-online", "standard", "No", update_modified=False)
				frappe.clear_cache(doctype="Page")
			except Exception:
				frappe.log_error(title="Pulse: fix Page pulse-online standard", message=frappe.get_traceback())
		return
	try:
		doc = frappe.new_doc("Page")
		doc.update(
			{
				"name": "pulse-online",
				"page_name": "pulse-online",
				"title": "Pulse — онлайн",
				"module": "Pulse",
				"standard": "No",
			}
		)
		doc.append("roles", {"role": "Desk User"})
		# Page.validate требует developer_mode для новых записей — из migrate это блокировало insert.
		doc.flags.ignore_validate = True
		# JS из hooks page_js; не создавать файлы в модуле при insert/on_update.
		doc.flags.do_not_update_json = True
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Pulse: ensure Page pulse-online", message=frappe.get_traceback())


def _hide_pulse_columns_from_user_list():
	"""Не показывать поля Pulse в стандартном списке User (отдельная страница pulse-online)."""
	for fn in ("pulse_last_seen_on", "pulse_presence_source"):
		name = frappe.db.get_value("Custom Field", {"dt": "User", "fieldname": fn}, "name")
		if not name:
			continue
		try:
			frappe.db.set_value("Custom Field", name, "in_list_view", 0, update_modified=False)
		except Exception:
			pass


def _ensure_pulse_user_field_in_list_view():
	"""Уже созданное поле: включить показ в списке User (обновление со старых установок)."""
	name = frappe.db.get_value(
		"Custom Field",
		{"dt": "User", "fieldname": "pulse_last_seen_on"},
		"name",
	)
	if not name:
		return
	try:
		frappe.db.set_value("Custom Field", name, "in_list_view", 1, update_modified=False)
	except Exception:
		pass


def _sync_legacy_pulse_profile_into_user():
	"""Одноразово подтянуть данные из legacy Pulse User Profile в поля User (если профиль был новее)."""
	if not frappe.db.exists("DocType", "Pulse User Profile"):
		return
	cols = frappe.db.get_table_columns("User")
	if "pulse_last_seen_on" not in cols:
		return
	try:
		profiles = frappe.get_all(
			"Pulse User Profile",
			fields=["user", "last_seen_on", "presence_source"],
			limit_page_length=50000,
		)
	except Exception:
		return

	for p in profiles:
		u = p.get("user")
		if not u or not frappe.db.exists("User", u):
			continue
		prof_ts = p.get("last_seen_on")
		if not prof_ts:
			continue
		cur = frappe.db.get_value("User", u, "pulse_last_seen_on")
		if cur and get_datetime(cur) >= get_datetime(prof_ts):
			continue
		values = {"pulse_last_seen_on": prof_ts}
		if "pulse_presence_source" in cols:
			ps = (p.get("presence_source") or "").strip()
			if ps:
				values["pulse_presence_source"] = ps
		try:
			frappe.db.set_value("User", u, values, update_modified=False)
		except Exception:
			continue


def _remove_pulse_user_profile_doctype():
	"""Удалить DocType Pulse User Profile из БД — присутствие только в полях User."""
	if not frappe.db.exists("DocType", "Pulse User Profile"):
		return
	try:
		if frappe.db.has_table("tabPulse User Profile"):
			frappe.db.sql("DELETE FROM `tabPulse User Profile`")
	except Exception:
		frappe.log_error(
			title="Pulse: clear tabPulse User Profile",
			message=frappe.get_traceback(),
		)
	try:
		frappe.delete_doc("DocType", "Pulse User Profile", force=1, ignore_permissions=True)
	except Exception:
		frappe.log_error(
			title="Pulse: delete DocType Pulse User Profile",
			message=frappe.get_traceback(),
		)
