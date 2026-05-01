from __future__ import annotations

from pulse_app.core.router import router
from pulse_app.http.routes import bind
from pulse_app.pulse.modules.presence.controller import PresenceController

router.route("/api/pulse/presence/ws-ticket", methods=["POST"])(
	bind(PresenceController, "issue_ws_ticket"),
)
router.route("/api/pulse/internal/presence-ws-upgrade-verify", methods=["POST"])(
	bind(PresenceController, "internal_ws_upgrade_verify"),
)
