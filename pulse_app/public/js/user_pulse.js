// User list + form: Pulse Online / Away / No data (окно 120 с — как ONLINE_WINDOW_SEC в service.py).
//
// В Frappe колонка Subject (Полное имя) не всегда проходит через formatters так же, как обычные поля
// (см. list_view.js get_subject_element / get_subject_text). Поэтому бейдж у имени рисуем
// дополнительно после render_list — это работает во всех версиях Desk с классическим ListView.

(function () {
	const PULSE_ONLINE_WINDOW_SEC = 120;
	const MERGE_REV = 4;

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

	/** После отрисовки строк — бейдж рядом с темой (имя), не зависит от formatters Subject. */
	function pulse_paint_user_rows(listview) {
		if (!listview || listview.doctype !== "User" || !listview.$result || !listview.data) {
			return;
		}
		const $ = window.jQuery;
		listview.$result.find(".pulse-user-badge-slot").remove();

		for (let i = 0; i < listview.data.length; i++) {
			const doc = listview.data[i];
			const name = doc.name;
			if (!name) {
				continue;
			}
			const esc = name.replace(/'/g, "\\'");
			const $cb = listview.$result.find(`.list-row-checkbox[data-name='${esc}']`);
			if (!$cb.length) {
				continue;
			}
			const $row = $cb.closest(".list-row-container").find(".list-row").first();
			if (!$row.length) {
				continue;
			}
			let $slot = $row.find(".list-subject").first();
			if (!$slot.length) {
				$slot = $row.find(".level-left .list-row-col").first();
			}
			if (!$slot.length) {
				continue;
			}
			const html = pulse_presence_badge_html(doc);
			$slot.append(
				`<span class="pulse-user-badge-slot" style="margin-left:6px;display:inline-block;vertical-align:middle;">${html}</span>`
			);
		}
	}

	function pulse_install_listview_dom_patch() {
		if (window.__pulse_lv_render_patched) {
			return true;
		}
		const LV = frappe.views && frappe.views.ListView;
		if (!LV || !LV.prototype || typeof LV.prototype.render_list !== "function") {
			return false;
		}
		window.__pulse_lv_render_patched = true;
		const orig = LV.prototype.render_list;
		LV.prototype.render_list = function () {
			const ret = orig.apply(this, arguments);
			try {
				if (this.doctype === "User") {
					pulse_paint_user_rows(this);
				}
			} catch (e) {
				if (window.console && console.error) {
					console.error("pulse_paint_user_rows", e);
				}
			}
			return ret;
		};
		return true;
	}

	function pulse_try_install_dom_patch() {
		if (pulse_install_listview_dom_patch()) {
			return;
		}
		[200, 600, 1500].forEach(function (ms) {
			setTimeout(function () {
				pulse_install_listview_dom_patch();
			}, ms);
		});
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

		// Subject колонку красит pulse_paint_user_rows; здесь — только отдельное поле в таблице.
		s.formatters = Object.assign({}, captured, {
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
							"Green/Away next to the name is Pulse (Desk + Socket.IO). «No data» means the field is empty or realtime is off. You can add the «Pulse last seen» column from the list menu."
						),
						indicator: "blue",
					});
				});
			} catch (e) {
				/* ignore */
			}
			try {
				pulse_paint_user_rows(listview);
			} catch (e2) {
				/* ignore */
			}
		};

		s._pulse_rev = MERGE_REV;

		sync_cur_list_settings_to_global(s);
	}

	merge_pulse_user_list_settings();
	pulse_try_install_dom_patch();

	frappe.ready(function () {
		merge_pulse_user_list_settings();
		pulse_try_install_dom_patch();
		refresh_user_list_if_open();
		try {
			if (window.cur_list && cur_list.doctype === "User") {
				pulse_paint_user_rows(cur_list);
			}
		} catch (e) {
			/* ignore */
		}
		[50, 400, 1200].forEach(function (ms) {
			setTimeout(function () {
				merge_pulse_user_list_settings();
				refresh_user_list_if_open();
				try {
					if (window.cur_list && cur_list.doctype === "User") {
						pulse_paint_user_rows(cur_list);
					}
				} catch (e) {
					/* ignore */
				}
			}, ms);
		});
	});

	if (frappe.router && typeof frappe.router.on === "function") {
		frappe.router.on("change", function () {
			frappe.after_ajax &&
				frappe.after_ajax(function () {
					merge_pulse_user_list_settings();
					refresh_user_list_if_open();
					try {
						if (window.cur_list && cur_list.doctype === "User") {
							pulse_paint_user_rows(cur_list);
						}
					} catch (e) {
						/* ignore */
					}
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
