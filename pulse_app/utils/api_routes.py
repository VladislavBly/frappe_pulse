"""before_request: dispatch /api/pulse/* to PulseRouter."""

from __future__ import annotations

import frappe

import pulse_app.http.routes.sample  # noqa: F401 — register routes
from pulse_app.core.router import router

router.build()

_handle_pulse_api = router.dispatch


def handle_api_routes():
	"""Register in hooks: before_request = ["pulse_app.utils.api_routes.handle_api_routes"]."""
	path = (frappe.local.request.path or "").strip().rstrip("/")
	if not path.startswith("/"):
		path = "/" + path

	if path == "/api/pulse" or path.startswith("/api/pulse/"):
		return _handle_pulse_api(path)

	return None
