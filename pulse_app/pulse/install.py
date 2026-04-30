"""Install / migrate: workspace + sidebar only."""

from __future__ import annotations

from pulse_app.pulse.setup.workspace_sidebar import (
	ensure_pulse_workspace_record,
	ensure_sidebar,
	sync_pulse_workspace_shortcuts_from_app,
)


def after_install():
	ensure_pulse_workspace_record()
	sync_pulse_workspace_shortcuts_from_app()
	ensure_sidebar()


def after_migrate():
	sync_pulse_workspace_shortcuts_from_app()
	ensure_sidebar()
