"""Онлайн только по Socket.IO: счётчики в Redis ведёт Node (pulse_app/realtime/handlers.js)."""

from __future__ import annotations

import frappe


def socket_ref_redis_key() -> str:
	return f"pulse_app:socket_ref:{frappe.local.site}"


def iter_socket_connected_usernames() -> list[str]:
	"""Пользователи с хотя бы одним активным Desk-сокетом (System User)."""
	key = socket_ref_redis_key()
	try:
		cache = frappe.cache()
		conn = getattr(cache, "redis_server", None) or getattr(cache, "redis", None)
		if conn is None:
			return []
		raw = conn.hgetall(key)
	except Exception:
		frappe.log_error(title="Pulse: socket_channel hgetall failed", message=frappe.get_traceback())
		return []

	out: list[str] = []
	for k, v in (raw or {}).items():
		ks = k.decode() if isinstance(k, bytes) else str(k)
		try:
			n = int(v.decode() if isinstance(v, bytes) else v)
		except (TypeError, ValueError):
			continue
		if n <= 0 or not ks or ks == "Guest":
			continue
		out.append(ks)
	return sorted(set(out))
