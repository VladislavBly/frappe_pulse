from __future__ import annotations

from typing import Any, Callable


def bind(controller_cls: type, method_name: str, *, doctype: str | None = None) -> Callable[..., Any]:
	def _view(**kwargs):
		ctrl = controller_cls(doctype) if doctype is not None else controller_cls()
		return getattr(ctrl, method_name)(**kwargs)

	_view.__name__ = f"{controller_cls.__name__}__{method_name}"
	_view.__qualname__ = _view.__name__
	_view.__doc__ = f"bind({controller_cls.__name__}, {method_name!r})"
	return _view


__all__ = ["bind"]
