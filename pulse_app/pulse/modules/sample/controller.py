from __future__ import annotations

from pulse_app.bin.serializers.http_response import json_response
from pulse_app.pulse.modules.sample.service import health_payload


class SampleController:
	def health(self):
		return json_response(health_payload())
