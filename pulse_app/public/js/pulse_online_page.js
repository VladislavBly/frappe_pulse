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

	/** После pulse_presence обновить таблицу (не чаще чем раз в interval ms). */
	const debouncedPresenceLoad =
		frappe.utils.debounce &&
		frappe.utils.debounce(function () {
			load(true);
		}, 200);

	function feedStorageKey() {
		return "pulse_live_activity_" + (frappe.session.user || "guest");
	}

	function appendLiveFeedEntry(data) {
		try {
			data = data || {};
			const key = feedStorageKey();
			let arr = [];
			try {
				arr = JSON.parse(sessionStorage.getItem(key) || "[]");
			} catch (e) {
				arr = [];
			}
			if (!Array.isArray(arr)) {
				arr = [];
			}
			arr.unshift({
				ts: new Date().toISOString(),
				kind: data.kind || "pulse_presence",
				user: data.user || "",
				service: data.service || "",
				rev: data.rev != null && data.rev !== "" ? String(data.rev) : "",
			});
			sessionStorage.setItem(key, JSON.stringify(arr.slice(0, 80)));
		} catch (e) {
			/* quota / private mode */
		}
	}

	function formatFeedLine(row) {
		const t = row.ts
			? new Date(row.ts).toLocaleTimeString(undefined, { hour12: false })
			: "";
		const u = row.user || "—";
		const svc = row.service ? " · " + row.service : "";
		const rv = row.rev ? " · rev " + row.rev : "";
		const k = row.kind || "";
		let msg = "";
		if (k === "offline") {
			msg = t + " · " + __("Offline") + " · " + u + svc + rv;
		} else if (k === "presence_update") {
			msg = t + " · " + __("Presence") + " · " + u + svc + rv;
		} else {
			msg = t + " · " + k + " · " + u + svc + rv;
		}
		return pulse_online_escape(msg);
	}

	function paintLiveFeed($root) {
		const $ul = $root.find(".pulse-online-live-feed-list");
		if (!$ul.length) {
			return;
		}
		let arr = [];
		try {
			arr = JSON.parse(sessionStorage.getItem(feedStorageKey()) || "[]");
		} catch (e) {
			arr = [];
		}
		if (!Array.isArray(arr)) {
			arr = [];
		}
		let html = "";
		if (!arr.length) {
			html =
				'<li class="pulse-online-live-feed-empty text-muted">' +
				pulse_online_escape(__("Waiting for pulse_presence events…")) +
				"</li>";
		} else {
			arr.forEach(function (row) {
				html += '<li class="pulse-online-live-feed-item">' + formatFeedLine(row) + "</li>";
			});
		}
		$ul.html(html);
	}

	function clearLiveFeed() {
		try {
			sessionStorage.removeItem(feedStorageKey());
		} catch (e) {
			/* ignore */
		}
		paintLiveFeed($main);
		frappe.show_alert({ message: __("Live feed cleared"), indicator: "blue" });
	}

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
		frappe.pages["pulse-online"]._pulseRtHandler = null;
	}

	function bindRealtime() {
		prevHandlerCleanup();
		function onPresence(data) {
			if (
				window.console &&
				console.info &&
				((frappe.boot && frappe.boot.developer_mode) ||
					(typeof localStorage !== "undefined" &&
						localStorage.getItem("pulse_presence_debug") === "1"))
			) {
				console.info("[pulse] pulse_presence event", data);
			}
			data = data || {};
			appendLiveFeedEntry(data);
			/* Событие offline от Node — сразу перечитать снимок, без ожидания debounce. */
			if (data.kind === "offline") {
				load(true);
			} else if (debouncedPresenceLoad) {
				debouncedPresenceLoad();
			} else {
				load(true);
			}
		}
		frappe.pages["pulse-online"]._pulseRtHandler = onPresence;
		frappe.realtime.on("pulse_presence", onPresence);
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
		if (
			window.console &&
			console.info &&
			((frappe.boot && frappe.boot.developer_mode) ||
				(typeof localStorage !== "undefined" &&
					localStorage.getItem("pulse_presence_debug") === "1"))
		) {
			console.info("[pulse] pulse_online_dashboard", msg);
		}
		const users = msg.online_users || [];
		const windowSecRaw = msg.online_window_sec ?? 120;
		const windowSecDisplay =
			windowSecRaw === 0 || windowSecRaw === "0"
				? __("Live (socket)")
				: String(windowSecRaw) + "s";
		const serverTime = msg.server_time || "";
		const me = msg.current_user || frappe.session.user;
		const events = msg.session_events || [];
		const scope = msg.session_events_scope || "mine";
		const onlineCount = users.length;
		const presenceRev =
			msg.presence_rev != null && msg.presence_rev !== ""
				? pulse_online_escape(String(msg.presence_rev))
				: null;

		const listSrc = msg.online_list_source || "";
		function onlineListSourceHint(mode) {
			if (mode === "socket") {
				return __(
					"Who is online: active Desk Socket.IO connections (Redis); updates via the standard realtime channel."
				);
			}
			return "";
		}

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
			(msg._pulse_debug
				? '<div class="alert alert-warning pulse-online-debug-banner mb-2"><strong>Pulse debug</strong> ' +
				  pulse_online_escape(
						__(
							'Disable: remove pulse_presence_debug from site_config. Console: localStorage.removeItem("pulse_presence_debug")'
						)
				  ) +
				  '<pre class="pulse-online-debug-pre">' +
				  pulse_online_escape(JSON.stringify(msg._pulse_debug, null, 2)) +
				  "</pre></div>"
				: "") +
			'<div class="pulse-online-toolbar">' +
			'<div class="pulse-online-live">' +
			'<span class="pulse-online-live-dot" aria-hidden="true"></span>' +
			'<span class="pulse-online-live-text">' +
			pulse_online_escape(__("Checking connection…")) +
			"</span>" +
			"</div>" +
			'<div class="pulse-online-meta">' +
			__("Updated") +
			': <span class="pulse-online-refreshed-at">—</span>' +
			(presenceRev
				? ' · <span class="text-muted" title="' +
				  pulse_online_escape(__("Presence revision from server (socket signal counter)")) +
				  '">rev ' +
				  presenceRev +
				  "</span>"
				: "") +
			"</div>" +
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
			pulse_online_escape(windowSecDisplay) +
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
			(listSrc
				? '<p class="text-muted small mb-3 pulse-online-list-source">' +
				  pulse_online_escape(onlineListSourceHint(listSrc)) +
				  "</p>"
				: "") +
			'<div class="pulse-online-card pulse-online-live-feed-card">' +
			'<div class="pulse-online-card-head">' +
			"<span><i class=\"fa fa-bolt fa-fw\"></i> " +
			__("Realtime activity") +
			"</span>" +
			'<button type="button" class="btn btn-xs btn-default pulse-online-clear-feed">' +
			__("Clear") +
			"</button>" +
			"</div>" +
			'<p class="pulse-online-live-feed-hint">' +
			pulse_online_escape(
				__(
					"Short Socket.IO signals (kind, user, service, rev). Who is online / history: loaded via authenticated API after each signal."
				)
			) +
			"</p>" +
			'<ul class="pulse-online-live-feed-list"></ul>' +
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
			__("Login / Logout history") +
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
		$main.on("click.pulseOnline", ".pulse-online-clear-feed", function (e) {
			e.preventDefault();
			clearLiveFeed();
		});
		paintLiveFeed($main);
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
	page.add_inner_button(__("Clear live feed"), clearLiveFeed);

	bindRealtime();

	if (frappe.pages["pulse-online"]._pollTimer) {
		clearInterval(frappe.pages["pulse-online"]._pollTimer);
	}
	frappe.pages["pulse-online"]._pollTimer = setInterval(function () {
		load(false);
	}, 8000);

	if (frappe.pages["pulse-online"]._liveUiTimer) {
		clearInterval(frappe.pages["pulse-online"]._liveUiTimer);
	}
	frappe.pages["pulse-online"]._liveUiTimer = setInterval(updateLiveStrip, 4000);

	document.addEventListener("visibilitychange", function () {
		if (document.visibilityState !== "visible") {
			return;
		}
		load(false);
		if (typeof pulse !== "undefined" && pulse && typeof pulse.http_mark_online === "function") {
			pulse.http_mark_online();
		}
	});

	load(false);
	if (typeof pulse !== "undefined" && pulse && typeof pulse.http_mark_online === "function") {
		pulse.http_mark_online();
	}
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
		frappe.pages["pulse-online"]._pulseRtHandler = null;
	}
};
