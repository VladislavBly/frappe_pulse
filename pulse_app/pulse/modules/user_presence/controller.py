"""HTTP: online users, session events — thin layer over service."""

from __future__ import annotations

import frappe
from werkzeug.wrappers import Response

from pulse_app.bin.serializers.http_response import json_response, json_response_list
from pulse_app.http.request_helpers import parse_json_body, query_int
from pulse_app.pulse.dashboard_access import user_can_view_pulse_online_dashboard
from pulse_app.pulse.modules.user_presence import service


class PulseUserPresenceController:
	def mark_online(self) -> Response:
		"""POST /api/pulse/presence/mark-online — JSON ``{"service": "my-spa"}`` (поле необязательно)."""
		user = frappe.session.user
		if not user or user == "Guest":
			frappe.throw(frappe._("Not authenticated"), frappe.AuthenticationError)
		body = parse_json_body()
		svc = body.get("service")
		return json_response(service.mark_online_presence(service=svc))

	def heartbeat(self) -> Response:
		"""POST /api/pulse/presence/heartbeat — то же, что mark-online (внешние клиенты)."""
		return self.mark_online()

	def mark_offline(self) -> Response:
		"""POST /api/pulse/presence/mark-offline."""
		user = frappe.session.user
		if not user or user == "Guest":
			frappe.throw(frappe._("Not authenticated"), frappe.AuthenticationError)
		return json_response(service.mark_offline_presence())

	def list_online(self) -> Response:
		return json_response(service.list_online_users())

	def list_session_events(self) -> Response:
		user = frappe.session.user
		if not user or user == "Guest":
			frappe.throw(frappe._("Not authenticated"), frappe.AuthenticationError)

		params = frappe.local.request.args or {}
		filter_user = (params.get("user") or "").strip() or None
		if filter_user and filter_user != user:
			if not user_can_view_pulse_online_dashboard(user):
				frappe.throw(frappe._("Not permitted"), frappe.PermissionError)

		limit_start = query_int(params.get("limit_start"), default=0)
		limit_page_length = query_int(params.get("limit_page_length"), default=50)
		if filter_user is None and not user_can_view_pulse_online_dashboard(user):
			filter_user = user

		rows, total = service.list_session_events(
			user=filter_user,
			limit_start=limit_start,
			limit_page_length=limit_page_length,
		)
		return json_response_list(rows, total)
