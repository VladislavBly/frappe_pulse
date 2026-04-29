"""Desk v16: Workspace Sidebar + привязка плитки приложения (как edoc_app)."""

from __future__ import annotations

import frappe

APP_NAME = "pulse_app"
SIDEBAR_TITLE = "Pulse"
WORKSPACE_NAME = "Pulse"


def ensure_sidebar() -> None:
	"""Создать/обновить Workspace Sidebar Pulse и синхронизировать Desktop Icon."""
	if not frappe.db.has_table("Workspace Sidebar"):
		return

	ensure_pulse_workspace_record()

	frappe.db.delete("Workspace Sidebar Item", {"parent": SIDEBAR_TITLE})
	frappe.db.commit()

	rows = _build_sidebar_rows()

	if frappe.db.exists("Workspace Sidebar", SIDEBAR_TITLE):
		sidebar = frappe.get_doc("Workspace Sidebar", SIDEBAR_TITLE)
		sidebar.items = []
		for row in rows:
			sidebar.append("items", row)
		sidebar.standard = 1
		sidebar.app = APP_NAME
		if not sidebar.get("header_icon"):
			sidebar.header_icon = "activity"
		sidebar.save(ignore_permissions=True)
	else:
		sidebar = frappe.new_doc("Workspace Sidebar")
		sidebar.title = SIDEBAR_TITLE
		sidebar.standard = 1
		sidebar.app = APP_NAME
		sidebar.header_icon = "activity"
		for row in rows:
			sidebar.append("items", row)
		sidebar.insert(ignore_permissions=True)

	_sync_desktop_icons_after_sidebar()


def upgrade_pulse_workspace_if_legacy() -> None:
	"""Убрать ярлык Pulse User Profile из сохранённого Workspace после перехода на поля User."""
	import json
	import os

	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return
	path = frappe.get_app_path("pulse_app", "pulse", "workspace", "pulse", "pulse.json")
	if not os.path.isfile(path):
		return
	with open(path, encoding="utf-8") as f:
		data = json.load(f)
	ws = frappe.get_doc("Workspace", WORKSPACE_NAME)
	legacy = False
	for ch in ws.shortcuts or []:
		if getattr(ch, "link_to", None) == "Pulse User Profile":
			legacy = True
			break
	if not legacy and ws.content and "Pulse User Profile" in ws.content:
		legacy = True
	if not legacy:
		return
	ws.shortcuts = []
	for s in data.get("shortcuts", []):
		ws.append("shortcuts", s)
	ws.content = data.get("content")
	ws.save(ignore_permissions=True)


def ensure_pulse_workspace_record() -> None:
	"""Импорт Workspace из JSON, если migrate не подтянул файл."""
	if frappe.db.exists("Workspace", WORKSPACE_NAME):
		return
	import json
	import os

	path = frappe.get_app_path("pulse_app", "pulse", "workspace", "pulse", "pulse.json")
	if not os.path.isfile(path):
		return
	try:
		with open(path, encoding="utf-8") as f:
			data = json.load(f)
		if data.get("doctype") != "Workspace":
			return
		doc = frappe.get_doc(data)
		doc.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="pulse_app: ensure_pulse_workspace_record", message=frappe.get_traceback())


def _sync_desktop_icons_after_sidebar() -> None:
	if not frappe.db.has_table("Desktop Icon"):
		return
	try:
		from frappe.desk.doctype.desktop_icon.desktop_icon import (
			create_desktop_icons_from_installed_apps,
			create_desktop_icons_from_workspace,
		)

		create_desktop_icons_from_installed_apps()
		create_desktop_icons_from_workspace()
	except Exception:
		frappe.log_error(title="pulse_app: sync desktop icons", message=frappe.get_traceback())
	ensure_app_desktop_icon()


def ensure_app_desktop_icon() -> None:
	"""Плитка в сетке приложений: App + External + route из add_to_apps_screen."""
	if not frappe.db.has_table("Desktop Icon"):
		return
	if APP_NAME not in frappe.get_installed_apps():
		return
	screens = frappe.get_hooks("add_to_apps_screen", app_name=APP_NAME) or []
	if not screens:
		return
	screen = screens[0]
	app_title = (frappe.get_hooks("app_title", app_name=APP_NAME) or [APP_NAME])[0]
	route = screen.get("route") or ""
	logo = screen.get("logo")

	from frappe.desk.doctype.desktop_icon.desktop_icon import clear_desktop_icons_cache

	meta_fields = {df.fieldname for df in frappe.get_meta("Desktop Icon").fields}
	values = {
		"label": app_title,
		"icon_type": "App",
		"link_type": "External",
		"link": route,
		"app": APP_NAME,
		"hidden": 0,
		"standard": 1,
		"link_to": None,
	}
	if logo:
		values["logo_url"] = logo
	if "sidebar" in meta_fields:
		values["sidebar"] = None

	name = frappe.db.get_value("Desktop Icon", {"app": APP_NAME, "icon_type": "App"}, "name")
	if not name:
		name = frappe.db.get_value("Desktop Icon", {"app": APP_NAME}, "name")
	if not name:
		name = frappe.db.get_value("Desktop Icon", {"label": app_title}, "name")
	if not name and frappe.db.exists("Desktop Icon", app_title):
		name = app_title
	if name:
		frappe.db.set_value("Desktop Icon", name, values, update_modified=False)
	else:
		try:
			max_idx = frappe.db.sql("select coalesce(max(`idx`), 0) from `tabDesktop Icon`")[0][0]
		except Exception:
			max_idx = 0
		values["doctype"] = "Desktop Icon"
		values["idx"] = int(max_idx) + 1
		frappe.get_doc(values).insert(ignore_permissions=True)

	clear_desktop_icons_cache()


def _build_sidebar_rows() -> list[dict]:
	rows: list[dict] = []

	def section(title: str) -> None:
		rows.append({"type": "Section Break", "label": title, "collapsible": 1})

	def doctype_link(label: str, doctype: str) -> None:
		rows.append(
			{
				"type": "Link",
				"label": label,
				"link_type": "DocType",
				"link_to": doctype,
			}
		)

	if frappe.db.exists("Workspace", WORKSPACE_NAME):
		rows.append(
			{
				"type": "Link",
				"label": "Home",
				"link_type": "Workspace",
				"link_to": WORKSPACE_NAME,
				"icon": "home",
			}
		)

	section("Pulse")
	doctype_link("Pulse Session Event", "Pulse Session Event")

	section("Users")
	doctype_link("User", "User")

	return rows
