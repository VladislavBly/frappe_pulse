"""Кто может видеть страницу Pulse — онлайн и REST-снимок «кто онлайн»."""

from __future__ import annotations

import json

import frappe


def get_pulse_online_dashboard_roles() -> list[str]:
	"""Роли из site_config ``pulse_online_dashboard_roles`` или только System Manager."""
	raw = frappe.conf.get("pulse_online_dashboard_roles")
	if not raw:
		return ["System Manager"]
	if isinstance(raw, str):
		s = raw.strip()
		if s.startswith("["):
			try:
				parsed = json.loads(s)
				if isinstance(parsed, list):
					return [str(x).strip() for x in parsed if str(x).strip()]
			except Exception:
				pass
		return [x.strip() for x in s.split(",") if x.strip()]
	if isinstance(raw, (list, tuple)):
		return [str(x).strip() for x in raw if str(x).strip()]
	return ["System Manager"]


def user_can_view_pulse_online_dashboard(user: str | None) -> bool:
	if not user or user == "Guest":
		return False
	roles = frappe.get_roles(user)
	return any(r in roles for r in get_pulse_online_dashboard_roles())


def viewer_sees_all_pulse_session_events(viewer: str) -> bool:
	"""Журнал Login/Logout целиком — тем же ролям, что и доступ к дашборду."""
	return user_can_view_pulse_online_dashboard(viewer)
