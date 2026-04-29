// Pulse: Socket.IO → mark_online; выход / закрытие вкладки → mark_offline; realtime pulse_presence (для страницы «Pulse — онлайн» и др.).

frappe.provide("pulse");

pulse.PULSE_OFFLINE_URL = "/api/method/pulse_app.api.presence.mark_offline";

pulse.http_mark_online = function () {
	if (!frappe.session || frappe.session.user === "Guest") {
		return;
	}
	frappe.call({
		method: "pulse_app.api.presence.mark_online",
		args: { service: "desk" },
		freeze: false,
	});
};

pulse._wait_desk_session_then_mark = function () {
	let fired = false;
	const deadline = Date.now() + 90000;
	const tick = function () {
		if (fired) {
			return;
		}
		const ok =
			frappe.session &&
			frappe.session.user &&
			frappe.session.user !== "Guest" &&
			frappe.csrf_token;
		if (ok) {
			fired = true;
			pulse.http_mark_online();
			return;
		}
		if (Date.now() < deadline) {
			setTimeout(tick, 400);
		}
	};
	tick();
};

pulse.send_offline_beacon = function () {
	if (!frappe.session || frappe.session.user === "Guest" || !frappe.csrf_token) {
		return;
	}
	const url = frappe.utils.get_full_url(pulse.PULSE_OFFLINE_URL);
	try {
		fetch(url, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-Frappe-CSRF-Token": frappe.csrf_token,
			},
			body: "{}",
			credentials: "same-origin",
			keepalive: true,
		});
	} catch (e) {
		/* ignore */
	}
};

pulse.setup_presence_realtime = function () {
	function call_mark_online() {
		pulse.http_mark_online();
	}

	function bind_socket(sock) {
		if (!sock || sock.__pulse_presence_bound) {
			return;
		}
		sock.__pulse_presence_bound = true;
		sock.on("connect", call_mark_online);
		sock.on("reconnect", call_mark_online);
		if (sock.connected) {
			call_mark_online();
		}
	}

	const io_client =
		(frappe.socketio && frappe.socketio.socket) || (frappe.socket && frappe.socket.socket);

	if (io_client) {
		bind_socket(io_client);
	} else {
		setTimeout(function () {
			const late =
				(frappe.socketio && frappe.socketio.socket) ||
				(frappe.socket && frappe.socket.socket);
			if (late) {
				bind_socket(late);
			}
		}, 1500);
	}

	function on_pulse_presence(data) {
		$(document).trigger("pulse_presence", data);
	}

	frappe.realtime.on("pulse_presence", on_pulse_presence);

	window.addEventListener("pagehide", function (ev) {
		if (ev.persisted) {
			return;
		}
		pulse.send_offline_beacon();
	});

	if (frappe.app && typeof frappe.app.logout === "function") {
		const _logout = frappe.app.logout.bind(frappe.app);
		frappe.app.logout = function () {
			pulse.send_offline_beacon();
			return _logout.apply(this, arguments);
		};
	}
};

frappe.ready(function () {
	pulse._wait_desk_session_then_mark();
	pulse.setup_presence_realtime();
	[900, 3500, 12000].forEach(function (ms) {
		setTimeout(function () {
			pulse.http_mark_online();
		}, ms);
	});
	setInterval(function () {
		pulse.http_mark_online();
	}, 45000);
});
