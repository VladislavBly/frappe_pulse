"""Desk bootinfo: интервал heartbeat и режим Redis-присутствия."""

from __future__ import annotations

import frappe

from pulse_app.pulse.modules.user_presence.service import ONLINE_WINDOW_SEC


def extend_bootinfo(bootinfo):
	if not isinstance(bootinfo, dict):
		return
	ttl = int(frappe.conf.get("pulse_redis_ttl_seconds") or 45)
	hb = int(frappe.conf.get("pulse_heartbeat_ms") or 15000)
	use_redis = bool(frappe.conf.get("pulse_redis_presence"))
	win = ttl if use_redis else int(frappe.conf.get("pulse_online_window_sec") or ONLINE_WINDOW_SEC)

	bootinfo["pulse"] = {
		"redis_presence": use_redis,
		"heartbeat_ms": max(hb, 5000),
		"redis_ttl_sec": ttl,
		"online_window_sec": win,
	}
