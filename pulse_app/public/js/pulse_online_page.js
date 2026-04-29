/** Страница Desk «pulse-online»: онлайн, User-ссылки, журнал сессий, realtime + опрос. */

frappe.pages["pulse-online"] = frappe.pages["pulse-online"] || {};

function pulse_online_escape(s) {
	return frappe.utils.escape_html ? frappe.utils.escape_html(String(s ?? "")) : String(s ?? "");
}

frappe.pages["pulse-online"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Pulse — who is online"),
		single_column: true,
	});

	const $main = $(page.main);
	let lastRefreshAt = null;
	let loadSeq = 0;

	function prevHandlerCleanup() {
		const prev = frappe.pages["pulse-online"]._pulseRtHandler;
		if (!prev) {
			return;
		}
		try {
			frappe.realtime.off("pulse_presence", prev);
		} catch (e) {
			/* ignore */
		}
		$(document).off("pulse_presence.pulseOnlinePage", prev);
		frappe.pages["pulse-online"]._pulseRtHandler = null;
	}

	function bindRealtime() {
		prevHandlerCleanup();
		var fn;
		if (frappe.utils.debounce) {
			fn = frappe.utils.debounce(function () {
				load(true);
			}, 380);
		} else {
			fn = function () {
				load(true);
			};
		}
		frappe.pages["pulse-online"]._pulseRtHandler = fn;
		frappe.realtime.on("pulse_presence", fn);
		$(document).on("pulse_presence.pulseOnlinePage", fn);
	}

	function flashToolbar() {
		const $tb = $main.find(".pulse-online-toolbar");
		$tb.addClass("pulse-online-toolbar--flash");
		setTimeout(function () {
			$tb.removeClass("pulse-online-toolbar--flash");
		}, 650);
	}

	function updateLiveStrip() {
		const sock = frappe.realtime && frappe.realtime.socket;
		const connected = !!(sock && sock.connected);
		const $dot = $main.find(".pulse-online-live-dot");
		const $txt = $main.find(".pulse-online-live-text");
		$dot.removeClass("is-offline is-polling");
		if (connected) {
			$txt.text(__("Realtime connected"));
		} else {
			$dot.addClass("is-polling");
			$txt.text(__("Socket disconnected — updates via polling"));
		}
		if (lastRefreshAt) {
			try {
				$main.find(".pulse-online-refreshed-at").text(lastRefreshAt.toLocaleTimeString());
			} catch (e) {
				$main.find(".pulse-online-refreshed-at").text("");
			}
		}
	}

	function fmtTime(iso) {
		if (!iso) {
			return "—";
		}
		try {
			return frappe.datetime.str_to_user ? frappe.datetime.str_to_user(iso) : String(iso);
		} catch (e) {
			return String(iso);
		}
	}

	function user_anchor(userRaw) {
		const u = userRaw || "";
		if (!u) {
			return "—";
		}
		const esc = pulse_online_escape(u);
		return (
			'<a href="#" class="pulse-online-user-link" data-user="' +
			esc +
			'">' +
			esc +
			"</a>"
		);
	}

	function render(msg, flash) {
		msg = msg || {};
		const users = msg.online_users || [];
		const windowSec = msg.online_window_sec ?? 120;
		const serverTime = msg.server_time || "";
		const me = msg.current_user || frappe.session.user;
		const events = msg.session_events || [];
		const scope = msg.session_events_scope || "mine";
		const onlineCount = users.length;

		const rows =
			users.length > 0
				? users
						.map(function (u) {
							const userRaw = u.user || "";
							const ls = fmtTime(u.last_seen_on);
							const svc = pulse_online_escape(u.service || "—");
							return (
								"<tr><td>" +
								user_anchor(userRaw) +
								'</td><td><span class="pulse-online-badge-on">' +
								pulse_online_escape(__("Online")) +
								"</span></td><td>" +
								pulse_online_escape(ls) +
								"</td><td>" +
								svc +
								"</td></tr>"
							);
						})
						.join("")
				: `<tr><td colspan="4" class="text-muted">${pulse_online_escape(
						__("No users in the online window.")
				  )}</td></tr>`;

		const evRows =
			events.length > 0
				? events
						.map(function (ev) {
							const id = pulse_online_escape(ev.id || "");
							const userRaw = ev.user || "";
							const et = pulse_online_escape(ev.event_type || "");
							const oc = fmtTime(ev.occurred_on);
							const ip = pulse_online_escape(ev.ip_address || "—");
							const evLink =
								'<a href="#" class="pulse-online-event-link text-muted small" data-event-name="' +
								id +
								'">' +
								id +
								"</a>";
							return (
								"<tr><td>" +
								evLink +
								"</td><td>" +
								user_anchor(userRaw) +
								"</td><td>" +
								et +
								"</td><td>" +
								pulse_online_escape(oc) +
								"</td><td>" +
								ip +
								"</td></tr>"
							);
						})
						.join("")
				: `<tr><td colspan="5" class="text-muted">${pulse_online_escape(
						__("No session events recorded yet (Login/Logout via Pulse).")
				  )}</td></tr>`;

		const scopeHint =
			scope === "all"
				? __("Showing events for all users (System Manager).")
				: __("Showing only your session events.");

		const html =
			'<div class="pulse-online-wrap">' +
			'<div class="pulse-online-toolbar">' +
			'<div class="pulse-online-live">' +
			'<span class="pulse-online-live-dot" aria-hidden="true"></span>' +
			'<span class="pulse-online-live-text">' +
			pulse_online_escape(__("Checking connection…")) +
			"</span>" +
			"</div>" +
			'<div class="pulse-online-meta">' +
			__("Updated") +
			': <span class="pulse-online-refreshed-at">—</span></div>' +
			"</div>" +
			'<div class="pulse-online-hero">' +
			'<div class="pulse-online-stat">' +
			'<div class="pulse-online-stat-value">' +
			onlineCount +
			"</div>" +
			'<div class="pulse-online-stat-label">' +
			__("Online now") +
			"</div>" +
			"</div>" +
			'<div class="pulse-online-stat">' +
			'<div class="pulse-online-stat-value">' +
			windowSec +
			"s" +
			"</div>" +
			'<div class="pulse-online-stat-label">' +
			__("Presence window") +
			"</div>" +
			"</div>" +
			'<div class="pulse-online-stat">' +
			'<div class="pulse-online-stat-value text-truncate" style="font-size:1rem">' +
			user_anchor(me) +
			"</div>" +
			'<div class="pulse-online-stat-label">' +
			__("You") +
			"</div>" +
			"</div>" +
			"</div>" +
			'<div class="alert alert-secondary pulse-online-conn mb-3">' +
			"<strong>" +
			__("API") +
			"</strong>: " +
			'<span class="pulse-online-conn-msg">' +
			__("Use «Ping» to verify mark_online from this page.") +
			"</span>" +
			"</div>" +
			'<div class="pulse-online-card">' +
			'<div class="pulse-online-card-head">' +
			'<i class="fa fa-users fa-fw"></i> ' +
			__("Who is online") +
			"</div>" +
			'<div class="pulse-online-card-body">' +
			'<div class="table-responsive">' +
			'<table class="table table-hover">' +
			"<thead><tr>" +
			"<th>" +
			__("User") +
			"</th>" +
			"<th>" +
			__("Status") +
			"</th>" +
			"<th>" +
			__("Last activity") +
			"</th>" +
			"<th>" +
			__("Client") +
			"</th>" +
			"</tr></thead>" +
			"<tbody>" +
			rows +
			"</tbody></table></div></div></div>" +
			'<div class="pulse-online-card">' +
			'<div class="pulse-online-card-head">' +
			'<i class="fa fa-history fa-fw"></i> ' +
			__("Session activity") +
			"</div>" +
			'<div class="pulse-online-card-body">' +
			'<p class="text-muted small px-3 pt-2 mb-2">' +
			pulse_online_escape(scopeHint) +
			"</p>" +
			'<div class="table-responsive">' +
			'<table class="table table-hover table-sm">' +
			"<thead><tr>" +
			"<th>" +
			__("ID") +
			"</th>" +
			"<th>" +
			__("User") +
			"</th>" +
			"<th>" +
			__("Event") +
			"</th>" +
			"<th>" +
			__("When") +
			"</th>" +
			"<th>" +
			__("IP") +
			"</th>" +
			"</tr></thead>" +
			"<tbody>" +
			evRows +
			"</tbody></table></div></div></div>" +
			'<p class="text-muted small">' +
			__("Server time") +
			": <strong>" +
			pulse_online_escape(serverTime) +
			"</strong></p>" +
			"</div>";

		$main.empty().append(html);

		lastRefreshAt = new Date();
		updateLiveStrip();
		if (flash) {
			flashToolbar();
		}

		$main.off("click.pulseOnline");
		$main.on("click.pulseOnline", ".pulse-online-user-link", function (e) {
			e.preventDefault();
			const u = ($(this).attr("data-user") || "").trim();
			if (u) {
				frappe.set_route("Form", "User", u);
			}
		});
		$main.on("click.pulseOnline", ".pulse-online-event-link", function (e) {
			e.preventDefault();
			const name = ($(this).attr("data-event-name") || "").trim();
			if (name) {
				frappe.set_route("Form", "Pulse Session Event", name);
			}
		});
	}

	function load(fromRealtime) {
		const mySeq = ++loadSeq;
		frappe.call({
			method: "pulse_app.api.presence.pulse_online_dashboard",
			freeze: false,
			callback: function (r) {
				if (mySeq !== loadSeq) {
					return;
				}
				render(r.message || {}, !!fromRealtime);
			},
			error: function () {
				if (mySeq !== loadSeq) {
					return;
				}
				$main.html(
					'<div class="alert alert-danger">' +
						pulse_online_escape(__("Could not load Pulse dashboard.")) +
						"</div>"
				);
			},
		});
	}

	function ping() {
		$main.find(".pulse-online-conn-msg").text(__("Pinging…"));
		frappe.call({
			method: "pulse_app.api.presence.mark_online",
			args: { service: "pulse-online-page" },
			freeze: true,
			freeze_message: __("Checking connection…"),
			callback: function () {
				$main.find(".pulse-online-conn-msg").html(
					'<span class="text-success">' +
						pulse_online_escape(__("OK — server accepted mark_online.")) +
						"</span>"
				);
				frappe.show_alert({ message: __("Pulse connection OK"), indicator: "green" });
				load(false);
			},
			error: function () {
				$main.find(".pulse-online-conn-msg").html(
					'<span class="text-danger">' +
						pulse_online_escape(__("Failed — see Error Log / Network.")) +
						"</span>"
				);
				frappe.show_alert({ message: __("Pulse connection failed"), indicator: "red" });
			},
		});
	}

	page.add_inner_button(__("Refresh"), function () {
		load(false);
	});
	page.add_inner_button(__("Ping"), ping);

	bindRealtime();

	if (frappe.pages["pulse-online"]._pollTimer) {
		clearInterval(frappe.pages["pulse-online"]._pollTimer);
	}
	frappe.pages["pulse-online"]._pollTimer = setInterval(function () {
		load(false);
	}, 20000);

	if (frappe.pages["pulse-online"]._liveUiTimer) {
		clearInterval(frappe.pages["pulse-online"]._liveUiTimer);
	}
	frappe.pages["pulse-online"]._liveUiTimer = setInterval(updateLiveStrip, 4000);

	load(false);
};

frappe.pages["pulse-online"].on_page_hide = function () {
	if (frappe.pages["pulse-online"]._pollTimer) {
		clearInterval(frappe.pages["pulse-online"]._pollTimer);
		frappe.pages["pulse-online"]._pollTimer = null;
	}
	if (frappe.pages["pulse-online"]._liveUiTimer) {
		clearInterval(frappe.pages["pulse-online"]._liveUiTimer);
		frappe.pages["pulse-online"]._liveUiTimer = null;
	}
	const h = frappe.pages["pulse-online"]._pulseRtHandler;
	if (h) {
		try {
			frappe.realtime.off("pulse_presence", h);
		} catch (e) {
			/* ignore */
		}
		$(document).off("pulse_presence.pulseOnlinePage", h);
		frappe.pages["pulse-online"]._pulseRtHandler = null;
	}
};
