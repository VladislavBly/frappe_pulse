/** Страница Desk «pulse-online»: список онлайн + проверка связи (отдельно от списка User). */

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

	function render(msg) {
		msg = msg || {};
		const users = msg.online_users || [];
		const windowSec = msg.online_window_sec ?? 120;
		const serverTime = msg.server_time || "";
		const me = msg.current_user || frappe.session.user;

		const rows =
			users.length > 0
				? users
						.map(function (u) {
							const user = frappe.utils.escape_html(u.user || "");
							const ls = fmtTime(u.last_seen_on);
							const svc = frappe.utils.escape_html(u.service || "—");
							return (
								"<tr><td><strong>" +
								user +
								"</strong></td><td>" +
								frappe.utils.escape_html(ls) +
								"</td><td>" +
								svc +
								"</td></tr>"
							);
						})
						.join("")
				: `<tr><td colspan="3" class="text-muted">${__("No users in the online window.")}</td></tr>`;

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
			": <strong>" +
			frappe.utils.escape_html(me) +
			"</strong>" +
			"</p>" +
			connHtml +
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
			"</tbody></table></div></div>";

		$main.empty().append(html);
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
