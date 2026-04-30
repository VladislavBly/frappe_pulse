// Pulse: Socket.IO → mark_online; offline beacon; realtime pulse_presence (Desk + страница pulse-online).

frappe.provide("pulse");

pulse.PULSE_OFFLINE_URL = "/api/method/pulse_app.api.presence.mark_offline";

/** Очередь mark_online: иначе mark_offline при pagehide может обработаться раньше, чем допишется уже отправленный mark_online — пользователь снова «онлайн». */
pulse._markOnlineChain = typeof Promise !== "undefined" ? Promise.resolve() : null;
pulse._presenceClosing = false;

/** Единая точка: во Frappe 16 realtime и legacy socketio — один объект. */
pulse._get_socket_io_socket = function () {
	var rt = frappe.realtime || frappe.socketio;
	if (rt && rt.socket) {
		return rt.socket;
	}
	return null;
};

pulse._heartbeat_ms = function () {
	var p = frappe.boot && frappe.boot.pulse;
	if (p && p.heartbeat_ms) {
		return Math.max(5000, parseInt(p.heartbeat_ms, 10) || 15000);
	}
	return 15000;
};

pulse.http_mark_online = function () {
	if (pulse._presenceClosing) {
		return;
	}
	if (!frappe.session || frappe.session.user === "Guest") {
		return;
	}
	if (!pulse._markOnlineChain) {
		frappe.call({
			method: "pulse_app.api.presence.mark_online",
			args: { service: "desk" },
			freeze: false,
			error: function (r) {
				if (frappe.boot && frappe.boot.developer_mode && window.console && console.error) {
					console.error("[pulse_app] mark_online failed", r);
				}
			},
		});
		return;
	}
	pulse._markOnlineChain = pulse._markOnlineChain.then(function () {
		return new Promise(function (resolve) {
			if (pulse._presenceClosing) {
				resolve();
				return;
			}
			frappe.call({
				method: "pulse_app.api.presence.mark_online",
				args: { service: "desk" },
				freeze: false,
				callback: resolve,
				error: function (r) {
					if (frappe.boot && frappe.boot.developer_mode && window.console && console.error) {
						console.error("[pulse_app] mark_online failed", r);
					}
					resolve();
				},
			});
		});
	});
};

pulse._wait_desk_session_then_mark = function () {
	var fired = false;
	var deadline = Date.now() + 90000;
	var tick = function () {
		if (fired) {
			return;
		}
		var ok =
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
	var url = frappe.utils.get_full_url(pulse.PULSE_OFFLINE_URL);
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
			return false;
		}
		sock.__pulse_presence_bound = true;
		sock.on("connect", call_mark_online);
		sock.on("reconnect", call_mark_online);
		if (sock.connected) {
			call_mark_online();
		}
		return true;
	}

	var sock0 = pulse._get_socket_io_socket();
	if (sock0 && bind_socket(sock0)) {
		/* ok */
	} else {
		var attempts = 0;
		var maxAttempts = 150;
		var timer = setInterval(function () {
			attempts += 1;
			var s = pulse._get_socket_io_socket();
			if (s && bind_socket(s)) {
				clearInterval(timer);
				return;
			}
			if (attempts >= maxAttempts) {
				clearInterval(timer);
			}
		}, 300);
	}

	function on_pulse_presence(data) {
		$(document).trigger("pulse_presence", data);
	}

	frappe.realtime.on("pulse_presence", on_pulse_presence);

	window.addEventListener("pagehide", function (ev) {
		if (ev.persisted) {
			return;
		}
		pulse._presenceClosing = true;
		var flushMs = 550;
		if (pulse._markOnlineChain) {
			Promise.race([
				pulse._markOnlineChain,
				new Promise(function (resolve) {
					setTimeout(resolve, flushMs);
				}),
			]).then(
				function () {
					pulse.send_offline_beacon();
				},
				function () {
					pulse.send_offline_beacon();
				}
			);
		} else {
			pulse.send_offline_beacon();
		}
	});

	if (frappe.app && typeof frappe.app.logout === "function") {
		var _logout = frappe.app.logout.bind(frappe.app);
		frappe.app.logout = function () {
			pulse._presenceClosing = true;
			pulse.send_offline_beacon();
			return _logout.apply(this, arguments);
		};
	}

	// SPA Desk: при смене маршрута сессия уже есть — обновить присутствие.
	function on_route_change() {
		setTimeout(call_mark_online, 400);
	}
	if (frappe.router && typeof frappe.router.on === "function") {
		try {
			frappe.router.on("change", on_route_change);
		} catch (e) {
			/* ignore */
		}
	}

	/* Фоновые вкладки: браузер режет setInterval → heartbeat реже TTL Redis. При возврате — сразу mark_online. */
	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState !== "visible") {
			return;
		}
		if (pulse._presenceClosing) {
			return;
		}
		pulse.http_mark_online();
	});
};

frappe.ready(function () {
	pulse._wait_desk_session_then_mark();
	pulse.setup_presence_realtime();
	[400, 900, 2000, 3500, 8000, 12000].forEach(function (ms) {
		setTimeout(function () {
			pulse.http_mark_online();
		}, ms);
	});
	window.addEventListener("load", function () {
		setTimeout(function () {
			pulse.http_mark_online();
		}, 500);
	});
	setInterval(function () {
		pulse.http_mark_online();
	}, pulse._heartbeat_ms());
});
