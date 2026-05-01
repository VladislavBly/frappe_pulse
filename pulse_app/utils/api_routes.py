"""before_request: dispatch ``/api/pulse/*`` via ``router`` (architectural HTTP layer)."""

from __future__ import annotations

import frappe

from pulse_app.core.router import router

import pulse_app.http.routes.presence  # noqa: F401 — registers routes
import pulse_app.http.routes.sample  # noqa: F401 — registers routes

router.build()


def handle_api_routes():
	path = (frappe.local.request.path or "").strip().rstrip("/")
	if not path.startswith("/"):
		path = "/" + path
	if not path.startswith("/api/pulse"):
		return None
	if path.startswith("/api/pulse/internal"):
		try:
			frappe.local.flags.ignore_csrf = True
		except Exception:
			pass
	return router.dispatch(path)
