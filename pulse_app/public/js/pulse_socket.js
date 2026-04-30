// Pulse: Socket.IO → mark_online при подключении (БД last_seen); realtime pulse_presence;
// Список онлайн — только счётчики Socket.IO в Redis; push — канал Redis ``events`` → Socket.IO.

frappe.provide("pulse");

pulse.PULSE_OFFLINE_URL = "/api/method/pulse_app.api.presence.mark_offline";

/** Очередь mark_online: последовательные вызовы без гонок. */
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

	function bind_realtime_presence() {
		var rt = frappe.realtime;
		if (rt && typeof rt.on === "function") {
			rt.on("pulse_presence", on_pulse_presence);
			return true;
		}
		return false;
	}
	if (!bind_realtime_presence()) {
		var rtAttempts = 0;
		var rtTimer = setInterval(function () {
			rtAttempts += 1;
			if (bind_realtime_presence() || rtAttempts >= 200) {
				clearInterval(rtTimer);
			}
		}, 150);
	}

	/* Закрытие вкладки: не вызывать mark_offline — иначе лента показывает Offline, а Redis
	   socket_ref ещё держит другие вкладки / сокет, и список «кто онлайн» расходится с лентой.
	   Выход из Desk обрабатывает сервер (on_logout) + при желании beacon ниже. */
	window.addEventListener("pagehide", function (ev) {
		if (ev.persisted) {
			return;
		}
		pulse._presenceClosing = true;
	});

	if (frappe.app && typeof frappe.app.logout === "function") {
		var _logout = frappe.app.logout.bind(frappe.app);
		frappe.app.logout = function () {
			pulse._presenceClosing = true;
			pulse.send_offline_beacon();
			return _logout.apply(this, arguments);
		};
	}

	if (frappe.router && typeof frappe.router.on === "function") {
		try {
			frappe.router.on("change", function () {
				setTimeout(call_mark_online, 400);
			});
		} catch (e) {
			/* ignore */
		}
	}
};

/** Desk под разные версии / порядок бандлов: ``frappe.ready`` может быть ещё не функцией. */
function pulse_boot_desk() {
	if (pulse._pulseDeskBooted) {
		return;
	}
	pulse._pulseDeskBooted = true;
	pulse._wait_desk_session_then_mark();
	pulse.setup_presence_realtime();
	window.addEventListener("load", function () {
		setTimeout(function () {
			pulse.http_mark_online();
		}, 500);
	});
}

(function pulse_schedule_desk_boot() {
	if (typeof frappe !== "undefined" && typeof frappe.ready === "function") {
		frappe.ready(pulse_boot_desk);
		return;
	}
	function defer(fn) {
		if (typeof jQuery !== "undefined") {
			jQuery(fn);
		} else if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", fn);
		} else {
			setTimeout(fn, 0);
		}
	}
	defer(function () {
		setTimeout(pulse_boot_desk, 50);
	});
})();
