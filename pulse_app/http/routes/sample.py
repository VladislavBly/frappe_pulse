from __future__ import annotations

from pulse_app.core.router import router
from pulse_app.http.routes import bind
from pulse_app.pulse.modules.sample.controller import SampleController

router.route("/api/pulse/health", methods=["GET"])(bind(SampleController, "health"))
