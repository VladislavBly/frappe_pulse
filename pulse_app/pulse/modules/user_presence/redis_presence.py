"""Опциональное присутствие в Redis с TTL (SETEX) — быстрый список «кто онлайн».

Включается в site_config.json: "pulse_redis_presence": 1
"""

from __future__ import annotations

import base64

import frappe

PREFIX = "pulse_app:presence:v1"


def redis_presence_enabled() -> bool:
	return bool(frappe.conf.get("pulse_redis_presence"))


def ttl_seconds() -> int:
	return int(frappe.conf.get("pulse_redis_ttl_seconds") or 45)


def _encode_user(user: str) -> str:
	return base64.urlsafe_b64encode(user.encode()).decode("ascii").rstrip("=")


def _decode_user(enc: str) -> str:
	pad = "=" * (-len(enc) % 4)
	return base64.urlsafe_b64decode((enc + pad).encode()).decode()


def _redis_key(user: str) -> str:
	return f"{PREFIX}:{frappe.local.site}:{_encode_user(user)}"


def _connection():
	cache = frappe.cache()
	conn = getattr(cache, "redis_server", None) or getattr(cache, "redis", None)
	if conn is None:
		raise RuntimeError("pulse_redis: frappe.cache has no redis_server")
	return conn


def touch(user: str, *, ttl: int | None = None) -> None:
	if not redis_presence_enabled() or not user or user == "Guest":
		return
	exp = ttl if ttl is not None else ttl_seconds()
	try:
		_connection().setex(_redis_key(user), exp, b"1")
	except Exception:
		frappe.log_error(title="Pulse: Redis presence touch failed", message=frappe.get_traceback())


def clear(user: str) -> None:
	if not redis_presence_enabled() or not user or user == "Guest":
		return
	try:
		_connection().delete(_redis_key(user))
	except Exception:
		pass


def iter_online_usernames() -> list[str]:
	if not redis_presence_enabled():
		return []
	site = frappe.local.site
	match = f"{PREFIX}:{site}:*"
	out: list[str] = []
	try:
		conn = _connection()
		for raw in conn.scan_iter(match=match, count=512):
			k = raw.decode() if isinstance(raw, bytes) else raw
			enc = k.rsplit(":", 1)[-1]
			try:
				out.append(_decode_user(enc))
			except Exception:
				continue
	except Exception:
		frappe.log_error(title="Pulse: Redis presence scan failed", message=frappe.get_traceback())
		return []
	return sorted(set(out))
