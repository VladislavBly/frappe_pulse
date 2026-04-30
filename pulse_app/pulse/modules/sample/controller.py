from __future__ import annotations

from werkzeug.wrappers import Response

from pulse_app.bin.serializers.http_response import json_response
from pulse_app.pulse.modules.sample import service


class SampleController:
	def health(self) -> Response:
		return json_response(service.health_payload())
