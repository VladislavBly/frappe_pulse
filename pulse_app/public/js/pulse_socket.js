// Pulse: Socket.IO — connect/reconnect → mark_online; выход/закрытие вкладки → mark_offline + realtime обновление у всех.

frappe.provide("pulse");

// До первого List/User объект frappe.listview_settings.User должен существовать, иначе BaseList
// берёт this.settings = {} (ссылка не на глобал), и позже formatters из pulse_app не видны.
frappe.provide("frappe.listview_settings");
if (!frappe.listview_settings.User) {
	frappe.listview_settings.User = {};
}

pulse.PULSE_OFFLINE_URL = "/api/method/pulse_app.api.presence.mark_offline";

/** POST с keepalive — доходит при закрытии вкладки (session cookie). */
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
		// ignore
	}
};

pulse.setup_presence_realtime = function () {
	function call_mark_online() {
		if (!frappe.session || frappe.session.user === "Guest") {
			return;
		}
		frappe.call({
			method: "pulse_app.api.presence.mark_online",
			args: { service: "desk" },
			freeze: false,
		});
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
		(frappe.socketio && frappe.socketio.socket) ||
		(frappe.socket && frappe.socket.socket);

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
		try {
			const route = frappe.get_route && frappe.get_route();
			const list_user =
				route &&
				route[0] === "List" &&
				route[1] === "User" &&
				window.cur_list &&
				cur_list.doctype === "User";
			if (list_user && cur_list.refresh) {
				cur_list.refresh();
			}
			if (
				window.cur_frm &&
				cur_frm.doctype === "User" &&
				data.user &&
				cur_frm.docname === data.user &&
				cur_frm.reload_doc
			) {
				cur_frm.reload_doc();
			}
		} catch (e) {
			// ignore
		}
	}

	frappe.realtime.on("pulse_presence", on_pulse_presence);

	// Закрытие вкладки / уход со страницы (не полагаемся на disconnect сокета — при reconnect будет снова online).
	window.addEventListener("pagehide", function (ev) {
		if (ev.persisted) {
			return;
		}
		pulse.send_offline_beacon();
	});

	// Явный выход из Desk (до редиректа на login).
	if (frappe.app && typeof frappe.app.logout === "function") {
		const _logout = frappe.app.logout.bind(frappe.app);
		frappe.app.logout = function () {
			pulse.send_offline_beacon();
			return _logout.apply(this, arguments);
		};
	}
};

frappe.ready(function () {
	pulse.setup_presence_realtime();
});
