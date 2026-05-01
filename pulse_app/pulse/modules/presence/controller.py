from __future__ import annotations

import secrets

import frappe
from werkzeug.wrappers import Response

from pulse_app.bin.serializers.http_response import json_error, json_response
from pulse_app.http.request_helpers import parse_json_body


def _presence_secret() -> str:
	return (frappe.conf.get("pulse_presence_auth_secret") or "").strip()


def _require_presence_secret() -> None:
	expected = _presence_secret()
	if not expected:
		frappe.throw(
			frappe._("Set pulse_presence_auth_secret in site_config.json"),
			frappe.PermissionError,
		)
	got = ""
	try:
		got = (frappe.get_request_header("X-Pulse-Presence-Secret") or "").strip()
	except Exception:
		got = (frappe.request.headers.get("X-Pulse-Presence-Secret") or "").strip()
	if got != expected:
		frappe.throw(frappe._("Invalid presence secret"), frappe.PermissionError)


def _user_from_sid(sid: str) -> str | None:
	if not sid or len(sid) > 128:
		return None
	user = frappe.db.get_value("Sessions", {"sid": sid}, "user")
	if not user or user == "Guest":
		return None
	return str(user)


def _consume_ticket(ticket: str) -> str | None:
	if not ticket or len(ticket) > 200:
		return None
	key = f"pulse_ws:tkt:{ticket}"
	user = frappe.cache().get_value(key)
	if not user:
		return None
	try:
		frappe.cache().delete_value(key)
	except Exception:
		pass
	if isinstance(user, dict):
		u = user.get("user")
		return str(u) if u and u != "Guest" else None
	if user == "Guest":
		return None
	return str(user)


class PresenceController:
	"""Frappe-side auth for presence-ws (ticket for browsers, internal verify for the Node service)."""

	def issue_ws_ticket(self) -> Response:
		if frappe.session.user == "Guest":
			return json_error(frappe._("Login required"), 401)
		try:
			ttl = int(frappe.conf.get("pulse_presence_ticket_ttl") or 120)
		except Exception:
			ttl = 120
		ttl = max(30, min(ttl, 600))
		ticket = secrets.token_urlsafe(32)
		key = f"pulse_ws:tkt:{ticket}"
		frappe.cache().set_value(key, frappe.session.user, expires_in_sec=ttl)
		return json_response({"ticket": ticket, "expires_in": ttl})

	def internal_ws_upgrade_verify(self) -> Response:
		_require_presence_secret()
		body = parse_json_body()
		ticket = (body.get("ticket") or "").strip()
		sid = (body.get("sid") or "").strip()

		if ticket:
			user = _consume_ticket(ticket)
			if not user:
				return json_error(frappe._("Invalid or expired ticket"), 401)
			return json_response({"user_id": user})

		if sid:
			user = _user_from_sid(sid)
			if not user:
				return json_error(frappe._("Invalid or expired session"), 401)
			return json_response({"user_id": user})

		return json_error(frappe._("Provide ticket or sid in JSON body"), 400)
