/** Страница Desk «pulse-online»: онлайн, ссылки на User, журнал Pulse Session Event. */

frappe.pages["pulse-online"] = frappe.pages["pulse-online"] || {};

frappe.pages["pulse-online"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Pulse — who is online"),
		single_column: true,
	});

	const $main = $(page.main);
	let pulseRealtimeBound = false;

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
		const esc = frappe.utils.escape_html(u);
		return (
			'<a href="#" class="pulse-online-user-link text-primary fw-bold" data-user="' +
			esc +
			'">' +
			esc +
			"</a>"
		);
	}

	function render(msg) {
		msg = msg || {};
		const users = msg.online_users || [];
		const windowSec = msg.online_window_sec ?? 120;
		const serverTime = msg.server_time || "";
		const me = msg.current_user || frappe.session.user;
		const events = msg.session_events || [];
		const scope = msg.session_events_scope || "mine";

		const rows =
			users.length > 0
				? users
						.map(function (u) {
							const userRaw = u.user || "";
							const ls = fmtTime(u.last_seen_on);
							const svc = frappe.utils.escape_html(u.service || "—");
							return (
								"<tr><td>" +
								user_anchor(userRaw) +
								"</td><td>" +
								frappe.utils.escape_html(ls) +
								"</td><td>" +
								svc +
								"</td></tr>"
							);
						})
						.join("")
				: `<tr><td colspan="3" class="text-muted">${__("No users in the online window.")}</td></tr>`;

		const evRows =
			events.length > 0
				? events
						.map(function (ev) {
							const id = frappe.utils.escape_html(ev.id || "");
							const userRaw = ev.user || "";
							const et = frappe.utils.escape_html(ev.event_type || "");
							const oc = fmtTime(ev.occurred_on);
							const ip = frappe.utils.escape_html(ev.ip_address || "—");
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
								frappe.utils.escape_html(oc) +
								"</td><td>" +
								ip +
								"</td></tr>"
							);
						})
						.join("")
				: `<tr><td colspan="5" class="text-muted">${__(
						"No session events recorded yet (Login/Logout via Pulse)."
				  )}</td></tr>`;

		const scopeHint =
			scope === "all"
				? __("Showing events for all users (System Manager).")
				: __("Showing only your session events.");

		const connHtml =
			'<div class="alert alert-secondary pulse-online-conn mb-3">' +
			"<strong>" +
			__("Connection") +
			"</strong>: " +
			'<span class="pulse-online-conn-msg">' +
			__("Use «Ping» to verify API from this browser.") +
			"</span>" +
			"</div>";

		const html =
			'<div class="pulse-online-dashboard">' +
			'<p class="text-muted small">' +
			__("Online window") +
			": <strong>" +
			windowSec +
			"</strong> s · " +
			__("Server time") +
			": <strong>" +
			frappe.utils.escape_html(serverTime) +
			"</strong> · " +
			__("You") +
			": " +
			user_anchor(me) +
			"</p>" +
			connHtml +
			"<h5 class=\"mt-4 mb-2\">" +
			__("Online now") +
			"</h5>" +
			'<div class="table-responsive">' +
			'<table class="table table-bordered">' +
			"<thead><tr>" +
			"<th>" +
			__("User") +
			"</th>" +
			"<th>" +
			__("Pulse last activity") +
			"</th>" +
			"<th>" +
			__("Client") +
			"</th>" +
			"</tr></thead>" +
			"<tbody>" +
			rows +
			"</tbody></table></div>" +
			"<h5 class=\"mt-4 mb-2\">" +
			__("Session activity") +
			"</h5>" +
			'<p class="text-muted small mb-2">' +
			frappe.utils.escape_html(scopeHint) +
			"</p>" +
			'<div class="table-responsive">' +
			'<table class="table table-bordered table-sm">' +
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
			"</tbody></table></div></div>";

		$main.empty().append(html);

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

	function load() {
		frappe.call({
			method: "pulse_app.api.presence.pulse_online_dashboard",
			freeze: false,
			callback: function (r) {
				render(r.message || {});
			},
			error: function () {
				$main.html(
					'<div class="alert alert-danger">' + __("Could not load Pulse dashboard.") + "</div>"
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
					'<span class="text-success">' + __("OK — server accepted mark_online.") + "</span>"
				);
				frappe.show_alert({ message: __("Pulse connection OK"), indicator: "green" });
				load();
			},
			error: function () {
				$main.find(".pulse-online-conn-msg").html(
					'<span class="text-danger">' + __("Failed — see Error Log / Network.") + "</span>"
				);
				frappe.show_alert({ message: __("Pulse connection failed"), indicator: "red" });
			},
		});
	}

	page.add_inner_button(__("Refresh"), load);
	page.add_inner_button(__("Ping connection"), ping);

	if (!pulseRealtimeBound) {
		pulseRealtimeBound = true;
		frappe.realtime.on("pulse_presence", function () {
			load();
		});
	}

	load();
	setInterval(load, 25000);
};
