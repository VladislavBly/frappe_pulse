"""Desk bootinfo: окно онлайн для UI (сокеты → всегда «живой» режим)."""

from __future__ import annotations

from pulse_app.pulse.modules.user_presence.service import (
	effective_online_window_sec,
	user_list_online_window_sec,
)


def extend_bootinfo(bootinfo):
	if not isinstance(bootinfo, dict):
		return
	bootinfo["pulse"] = {
		"online_window_sec": effective_online_window_sec(),
		"user_list_online_window_sec": user_list_online_window_sec(),
	}
