"""before_request: dispatch /api/pulse/* to PulseRouter (same layering idea as edoc_app.utils.api_routes)."""

from __future__ import annotations

import frappe

# Import route modules so @router.route decorators run.
import pulse_app.http.routes.presence  # noqa: F401
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
