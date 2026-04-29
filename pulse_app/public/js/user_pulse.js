// User list + form: Pulse Online / Away / No data (окно 120 с — как ONLINE_WINDOW_SEC в service.py).
//
// ВАЖНО (Frappe BaseList): при первом открытии List/User, если frappe.listview_settings.User
// ещё undefined, ListView делает this.settings = {} — объект не привязан к глобалу. Последующее
// присвоение frappe.listview_settings.User = { formatters: ... } не обновляет уже открытый список.
// Поэтому: (1) pulse_socket.js создаёт пустой User до ListView; (2) здесь мутируем ТОТ ЖЕ объект;
// (3) после merge подставляем cur_list.settings = frappe.listview_settings.User.

(function () {
	const PULSE_ONLINE_WINDOW_SEC = 120;
	const MERGE_REV = 3;

	function pulse_presence_badge_html(doc) {
		if (!doc || !doc.pulse_last_seen_on) {
			return `<span class="indicator-pill no-indicator ellipsis pulse-presence-tag">${frappe.utils.escape_html(__("Pulse: No data"))}</span>`;
		}
		const t = new Date(doc.pulse_last_seen_on).getTime();
		if (Number.isNaN(t)) {
			return frappe.utils.escape_html(String(doc.pulse_last_seen_on));
		}
		const sec = (Date.now() - t) / 1000;
		const online = sec >= 0 && sec <= PULSE_ONLINE_WINDOW_SEC;
		const label = online ? __("Online") : __("Away");
		const color = online ? "green" : "gray";
		const time =
			frappe.datetime.str_to_user && doc.pulse_last_seen_on
				? frappe.datetime.str_to_user(doc.pulse_last_seen_on)
				: doc.pulse_last_seen_on;
		return `<span class="indicator-pill ${color} ellipsis pulse-presence-tag" title="${frappe.utils.escape_html(
			doc.pulse_presence_source || ""
		)}">${frappe.utils.escape_html(label)} · ${frappe.utils.escape_html(time)}</span>`;
	}

	function pulse_get_indicator(doc) {
		if (!doc || !doc.pulse_last_seen_on) {
			return;
		}
		const t = new Date(doc.pulse_last_seen_on).getTime();
		if (Number.isNaN(t)) {
			return;
		}
		const sec = (Date.now() - t) / 1000;
		if (sec >= 0 && sec <= PULSE_ONLINE_WINDOW_SEC) {
			return [__("Pulse Online"), "green", "pulse_last_seen_on"];
		}
		return [__("Pulse Away"), "gray", "pulse_last_seen_on"];
	}

	function sync_cur_list_settings_to_global(s) {
		try {
			if (window.cur_list && cur_list.doctype === "User") {
				cur_list.settings = s;
			}
		} catch (e) {
			/* ignore */
		}
	}

	function refresh_user_list_if_open() {
		try {
			const r = frappe.get_route && frappe.get_route();
			if (r && r[0] === "List" && r[1] === "User" && window.cur_list && cur_list.doctype === "User") {
				cur_list.refresh && cur_list.refresh();
			}
		} catch (e) {
			/* ignore */
		}
	}

	function merge_pulse_user_list_settings() {
		frappe.provide("frappe.listview_settings");
		if (!frappe.listview_settings.User) {
			frappe.listview_settings.User = {};
		}

		const s = frappe.listview_settings.User;
		if (s._pulse_rev === MERGE_REV) {
			sync_cur_list_settings_to_global(s);
			return;
		}

		const captured = Object.assign({}, s.formatters || {});
		const prev_onload = s.onload;
		const prev_get_indicator = s.get_indicator;

		s.add_fields = Array.from(
			new Set([...(s.add_fields || []), "pulse_last_seen_on", "pulse_presence_source"])
		);

		s.formatters = Object.assign({}, captured, {
			full_name(value, df, doc) {
				let html;
				if (captured.full_name) {
					html = captured.full_name(value, df, doc);
				} else {
					html = frappe.utils.escape_html(value || doc.name || "");
				}
				return `${html}&nbsp;${pulse_presence_badge_html(doc)}`;
			},
			pulse_last_seen_on(value, df, doc) {
				if (captured.pulse_last_seen_on) {
					return captured.pulse_last_seen_on(value, df, doc);
				}
				return pulse_presence_badge_html(doc);
			},
		});

		s.get_indicator = function (doc) {
			const mine = pulse_get_indicator(doc);
			if (mine) {
				return mine;
			}
			return prev_get_indicator ? prev_get_indicator(doc) : undefined;
		};

		s.onload = function (listview) {
			if (prev_onload) {
				prev_onload(listview);
			}
			try {
				listview.page.add_inner_button(__("Pulse help"), function () {
					frappe.msgprint({
						title: __("Pulse"),
						message: __(
							"Online if last activity within {0} seconds (Desk + Socket.IO). " +
								"If you always see «Pulse: No data», run migrate and clear cache, and ensure the realtime service is running.",
							[PULSE_ONLINE_WINDOW_SEC]
						),
						indicator: "blue",
					});
				});
			} catch (e) {
				/* ignore */
			}
		};

		s._pulse_rev = MERGE_REV;

		sync_cur_list_settings_to_global(s);
	}

	merge_pulse_user_list_settings();

	frappe.ready(function () {
		merge_pulse_user_list_settings();
		refresh_user_list_if_open();
		[50, 400, 1200].forEach(function (ms) {
			setTimeout(function () {
				merge_pulse_user_list_settings();
				refresh_user_list_if_open();
			}, ms);
		});
	});

	if (frappe.router && typeof frappe.router.on === "function") {
		frappe.router.on("change", function () {
			frappe.after_ajax &&
				frappe.after_ajax(function () {
					merge_pulse_user_list_settings();
					refresh_user_list_if_open();
				});
		});
	}

	if (!window.__pulse_user_form_bound__) {
		window.__pulse_user_form_bound__ = true;
		frappe.ui.form.on("User", {
			refresh(frm) {
				frm.page.wrapper.find(".pulse-form-presence").remove();
				const badge = pulse_presence_badge_html(frm.doc);
				const $area =
					frm.page.wrapper.find(".page-head .title-area").first().length
						? frm.page.wrapper.find(".page-head .title-area").first()
						: frm.page.wrapper.find(".page-head").first();
				if ($area.length) {
					$area.append(
						`<span class="pulse-form-presence" style="margin-left:10px;display:inline-block;vertical-align:middle;">${badge}</span>`
					);
				}
			},
		});
	}
})();
