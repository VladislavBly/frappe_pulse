from __future__ import annotations

import json

import frappe


def parse_json_body() -> dict:
	req = frappe.local.request
	if not req or not req.data:
		return {}
	try:
		raw = req.get_data(cache=True, as_text=True) or ""
		if not raw.strip():
			return {}
		out = json.loads(raw)
		return out if isinstance(out, dict) else {}
	except Exception:
		frappe.throw(frappe._("Invalid JSON body"), frappe.ValidationError)


def query_int(value, *, default: int = 0) -> int:
	try:
		if value is None or value == "":
			return default
		return int(value)
	except Exception:
		return default
