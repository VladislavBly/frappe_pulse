from __future__ import annotations

import json
from datetime import date, datetime

from werkzeug.wrappers import Response


def json_serial(obj):
	if isinstance(obj, (date, datetime)):
		return obj.isoformat()
	if isinstance(obj, dict):
		return {k: json_serial(v) for k, v in obj.items()}
	if isinstance(obj, list):
		return [json_serial(v) for v in obj]
	return obj


def json_response(data: dict | list, status: int = 200):
	body = json.dumps({"data": json_serial(data)}, ensure_ascii=False)
	return Response(body, mimetype="application/json", status=status)


def _error_code(status: int) -> str:
	if status == 401:
		return "UNAUTHORIZED"
	if status == 403:
		return "FORBIDDEN"
	if status == 404:
		return "NOT_FOUND"
	if status == 422:
		return "VALIDATION_ERROR"
	if status >= 500:
		return "INTERNAL_ERROR"
	return "BAD_REQUEST"


def json_error(
	message: str,
	status: int = 400,
	code: str | None = None,
	*,
	headers: dict[str, str] | None = None,
):
	err_code = code or _error_code(status)
	payload = {"error": {"code": err_code, "message": message}}
	body = json.dumps(payload, ensure_ascii=False)
	return Response(body, mimetype="application/json", status=status, headers=headers or None)
