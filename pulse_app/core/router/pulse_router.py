from __future__ import annotations

import traceback

import frappe
import requests
from werkzeug.exceptions import MethodNotAllowed, NotFound
from werkzeug.routing import Map, Rule

from pulse_app.bin.serializers.http_response import json_error


def _rollback_safe():
	try:
		frappe.db.rollback()
	except Exception:
		pass


def _resolve_request_id() -> str:
	try:
		existing = getattr(frappe.local, "pulse_request_id", None)
		if existing:
			return existing
		incoming = (frappe.local.request.headers.get("X-Request-Id") or "").strip()
	except Exception:
		incoming = ""
	rid = incoming or frappe.generate_hash(length=12)
	try:
		frappe.local.pulse_request_id = rid
	except Exception:
		pass
	return rid


def _debug_enabled() -> bool:
	try:
		return bool(frappe.conf.get("pulse_api_debug"))
	except Exception:
		return False


class PulseRouter:
	"""Registry of (path, methods) → handler with centralised error handling (EDOC-style)."""

	def __init__(self):
		self._rules: list[Rule] = []
		self._handlers: dict[str, tuple] = {}
		self._map: Map | None = None

	def route(
		self,
		path: str,
		*,
		methods: list[str] | None = None,
		rollback: bool = False,
		name: str | None = None,
	):
		def decorator(fn):
			ep = name or (fn.__module__ + "." + fn.__qualname__)
			if ep in self._handlers:
				raise ValueError(f"PulseRouter: duplicate endpoint name {ep!r}")
			self._rules.append(
				Rule(path, endpoint=ep, methods=methods or ["GET"], strict_slashes=False),
			)
			self._handlers[ep] = (fn, rollback)
			return fn

		return decorator

	def build(self):
		self._map = Map(self._rules)

	def iter_routes(self) -> list[dict]:
		out: list[dict] = []
		for rule in self._rules:
			methods = sorted((rule.methods or set()) - {"HEAD", "OPTIONS"})
			out.append({"path": rule.rule, "methods": methods, "endpoint": rule.endpoint})
		out.sort(key=lambda r: (r["path"], ",".join(r["methods"])))
		return out

	def dispatch(self, path: str, method: str | None = None) -> object:
		if method is None:
			method = (frappe.local.request.method or "GET").upper()

		p = (path or "").strip()
		if not p.startswith("/"):
			p = "/" + p
		p = p.rstrip("/") or "/"

		request_id = _resolve_request_id()
		extra_headers = {"X-Request-Id": request_id}

		adapter = self._map.bind("")
		try:
			endpoint, kwargs = adapter.match(p, method=method)
		except NotFound:
			return json_error("Not found", 404, headers=extra_headers)
		except MethodNotAllowed as e:
			allowed = sorted((e.valid_methods or set()) - {"HEAD", "OPTIONS"})
			headers = dict(extra_headers)
			if allowed:
				headers["Allow"] = ", ".join(allowed)
			return json_error("Method not allowed", 405, headers=headers)

		fn, rollback = self._handlers[endpoint]
		try:
			response = fn(**kwargs)
			try:
				response.headers.setdefault("X-Request-Id", request_id)
			except Exception:
				pass
			return response
		except frappe.AuthenticationError as e:
			if rollback:
				_rollback_safe()
			return json_error(str(e) or "Authentication required", 401, headers=extra_headers)
		except frappe.PermissionError as e:
			if rollback:
				_rollback_safe()
			return json_error(str(e) or "Permission denied", 403, headers=extra_headers)
		except frappe.DoesNotExistError as e:
			if rollback:
				_rollback_safe()
			return json_error(str(e) or "Not found", 404, headers=extra_headers)
		except frappe.ValidationError as e:
			if rollback:
				_rollback_safe()
			return json_error(str(e) or "Validation error", 422, headers=extra_headers)
		except requests.RequestException as e:
			_rollback_safe()
			return json_error(str(e), 502, headers=extra_headers)
		except Exception as e:
			if rollback:
				_rollback_safe()
			debug = None
			if _debug_enabled():
				debug = {
					"traceback": traceback.format_exc(),
					"endpoint": endpoint,
					"exception": type(e).__name__,
				}
			return json_error(str(e) or type(e).__name__, 500, headers=extra_headers, debug=debug)


router = PulseRouter()
