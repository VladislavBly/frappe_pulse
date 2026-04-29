from __future__ import annotations

from pulse_app.core.router import router
from pulse_app.http.routes import bind
from pulse_app.pulse.modules.user_presence.controller import PulseUserPresenceController

# Presence & session history API (Desk, внешние SPA по REST + тот же realtime-канал pulse_presence).

router.route("/api/pulse/presence/mark-online", methods=["POST"], rollback=True)(
	bind(PulseUserPresenceController, "mark_online"),
)

router.route("/api/pulse/presence/mark-offline", methods=["POST"], rollback=True)(
	bind(PulseUserPresenceController, "mark_offline"),
)

router.route("/api/pulse/presence/online", methods=["GET"])(
	bind(PulseUserPresenceController, "list_online"),
)

router.route("/api/pulse/session-events", methods=["GET"])(
	bind(PulseUserPresenceController, "list_session_events"),
)
