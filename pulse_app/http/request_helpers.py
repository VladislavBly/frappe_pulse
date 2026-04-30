from __future__ import annotations

import frappe


def parse_json_body() -> dict:
	raw = frappe.local.request.get_data(as_text=True) or ""
	if raw.strip():
		ctype = (frappe.local.request.content_type or "").lower()
		if ctype and "application/json" not in ctype:
			frappe.throw(
				frappe._("Expected Content-Type: application/json (got {0})").format(ctype or "—"),
				frappe.ValidationError,
			)
	try:
		body = frappe.parse_json(raw or "{}") or {}
	except Exception:
		frappe.throw(frappe._("Invalid JSON body"), frappe.ValidationError)
	if not isinstance(body, dict):
		frappe.throw(frappe._("JSON body must be an object"), frappe.ValidationError)
	return body


def query_str(v) -> str | None:
	if v is None:
		return None
	if isinstance(v, (list, tuple)):
		return (v[0] or "").strip() if v else None
	return (str(v) or "").strip() or None
