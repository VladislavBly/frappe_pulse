from __future__ import annotations

import frappe
from werkzeug.exceptions import MethodNotAllowed, NotFound
from werkzeug.routing import Map, Rule

from pulse_app.bin.serializers.http_response import json_error


class PulseRouter:
	"""path + methods → handler; вызывайте router.build() после регистрации маршрутов."""

	def __init__(self):
		self._rules: list[Rule] = []
		self._handlers: dict[str, object] = {}
		self._map: Map | None = None

	def route(self, path: str, *, methods: list[str] | None = None, name: str | None = None):
		def decorator(fn):
			ep = name or (fn.__module__ + "." + fn.__qualname__)
			if ep in self._handlers:
				raise ValueError(f"PulseRouter: duplicate endpoint name {ep!r}")
			self._rules.append(
				Rule(path, endpoint=ep, methods=methods or ["GET"], strict_slashes=False),
			)
			self._handlers[ep] = fn
			return fn

		return decorator

	def build(self) -> None:
		self._map = Map(self._rules)

	def dispatch(self, path: str, method: str | None = None) -> object:
		if method is None:
			method = (frappe.local.request.method or "GET").upper()

		p = (path or "").strip()
		if not p.startswith("/"):
			p = "/" + p
		p = p.rstrip("/") or "/"

		adapter = self._map.bind("")
		try:
			endpoint, kwargs = adapter.match(p, method=method)
		except NotFound:
			return json_error("Not found", 404)
		except MethodNotAllowed as e:
			allowed = sorted((e.valid_methods or set()) - {"HEAD", "OPTIONS"})
			h = {"Allow": ", ".join(allowed)} if allowed else None
			return json_error("Method not allowed", 405, headers=h)

		fn = self._handlers[endpoint]
		try:
			return fn(**kwargs)
		except frappe.AuthenticationError as e:
			return json_error(str(e) or "Unauthorized", 401)
		except frappe.PermissionError as e:
			return json_error(str(e) or "Forbidden", 403)
		except frappe.DoesNotExistError as e:
			return json_error(str(e) or "Not found", 404)
		except frappe.ValidationError as e:
			return json_error(str(e) or "Validation error", 422)
		except Exception as e:
			return json_error(str(e) or type(e).__name__, 500)


router = PulseRouter()
