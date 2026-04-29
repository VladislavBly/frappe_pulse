// User list + form: Pulse Online / Away / No data в колонке pulse_last_seen_on (окно 120 с — как ONLINE_WINDOW_SEC в service.py).
//
// Список: только formatter колонки + add_fields (без бейджей рядом с именем).
// Форма User: полоска под заголовком (v16) или сайдбар / заголовок как запасные варианты.

(function () {
	const PULSE_ONLINE_WINDOW_SEC = 120;
	const MERGE_REV = 6;

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

	function pulse_clear_user_form_pulse_ui(frm) {
		if (!frm || !frm.wrapper || !frm.wrapper.length) {
			return;
		}
		try {
			frm.wrapper.find(".pulse-form-presence-wrap, .pulse-form-presence-banner").remove();
			if (frm.page && frm.page.wrapper && frm.page.wrapper.length) {
				frm.page.wrapper.find(".pulse-form-presence").remove();
			}
		} catch (e) {
			/* ignore */
		}
	}

	/** Frappe v16+: основная область формы — заметная полоска сразу под page-head. */
	function pulse_inject_user_form_main_banner(frm, doc) {
		const $ = window.jQuery;
		doc = doc || frm.doc;
		const badge = pulse_presence_badge_html(doc);
		const label = frappe.utils.escape_html(__("Pulse presence"));

		const block = `
			<div class="pulse-form-presence-banner" style="margin: 0 0 12px 0; padding: 12px 14px; border-radius: var(--border-radius-md, 8px); border: 1px solid var(--border-color, rgba(0,0,0,.12)); background: var(--control-bg, var(--fg-color, #f8f9fa));">
				<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
					<span class="text-muted" style="font-size: 12px;">${label}</span>
					<span class="pulse-form-presence-banner-inner">${badge}</span>
				</div>
			</div>`;

		const $main = frm.wrapper.find(".layout-main-section").first();
		if (!$main.length) {
			return false;
		}
		const $head = $main.children(".page-head").first().length
			? $main.children(".page-head").first()
			: $main.find(".page-head").first();
		if ($head.length) {
			$head.after(block);
			return true;
		}
		$main.prepend(block);
		return true;
	}

	function pulse_inject_user_form_sidebar_badge(frm, doc) {
		const $ = window.jQuery;
		doc = doc || frm.doc;
		const badge = pulse_presence_badge_html(doc);
		const label = frappe.utils.escape_html(__("Pulse presence"));

		const block = `
			<div class="pulse-form-presence-wrap" style="margin: 0 -4px 14px; padding: 12px 8px 14px; text-align: center; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));">
				<div class="text-muted small" style="margin-bottom: 8px; letter-spacing: 0.02em;">${label}</div>
				<div class="pulse-form-presence-badge" style="display: inline-flex; justify-content: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-radius: var(--border-radius-lg, 10px); background: var(--control-bg, #f4f4f4);">
					${badge}
				</div>
			</div>`;

		const $side = frm.wrapper.find(".layout-side-section").first();
		if (!$side.length) {
			return false;
		}

		let $anchor = $side.find(".sidebar-image-section, .show-sidebar-image, .form-sidebar .sidebar-image-wrapper").first();
		if (!$anchor.length) {
			const $imgw = $side.find(".sidebar-image-wrapper").first();
			if ($imgw.length) {
				$anchor = $imgw.closest(".sidebar-image-section").length
					? $imgw.closest(".sidebar-image-section")
					: $imgw.parent();
			}
		}
		if (!$anchor.length) {
			$anchor = $side.find(".form-sidebar .user-image, .standard-sidebar .sidebar-image-wrapper").first();
		}

		if ($anchor.length) {
			$anchor.after(block);
			return true;
		}

		const $sb = $side.find(".form-sidebar .form-attachments, .form-sidebar").first();
		if ($sb.length) {
			$sb.prepend(block);
			return true;
		}

		return false;
	}

	function pulse_inject_user_form_title_fallback(frm, doc) {
		doc = doc || frm.doc;
		const badge = pulse_presence_badge_html(doc);
		const $area =
			frm.page.wrapper.find(".page-head .title-area").first().length
				? frm.page.wrapper.find(".page-head .title-area").first()
				: frm.page.wrapper.find(".page-head").first();
		if ($area.length) {
			$area.append(
				`<span class="pulse-form-presence" style="margin-left:10px;display:inline-block;vertical-align:middle;">${badge}</span>`
			);
			return true;
		}
		return false;
	}

	function pulse_place_user_form_presence(frm, merged) {
		pulse_clear_user_form_pulse_ui(frm);
		if (pulse_inject_user_form_main_banner(frm, merged)) {
			return true;
		}
		if (pulse_inject_user_form_sidebar_badge(frm, merged)) {
			return true;
		}
		return pulse_inject_user_form_title_fallback(frm, merged);
	}

	function pulse_refresh_open_user_form_presence() {
		try {
			const r = frappe.get_route && frappe.get_route();
			if (!r || r[0] !== "Form" || r[1] !== "User" || !window.cur_frm || !cur_frm.doc || !cur_frm.doc.name) {
				return;
			}
			const frm = cur_frm;
			frappe.call({
				method: "pulse_app.api.presence.desk_pulse_snapshot",
				args: { users: JSON.stringify([frm.doc.name]) },
				freeze: false,
				callback: function (resp) {
					const row = (resp.message || [])[0];
					const merged = row ? Object.assign({}, frm.doc, row) : frm.doc;
					pulse_place_user_form_presence(frm, merged);
				},
				error: function () {
					pulse_place_user_form_presence(frm, frm.doc);
				},
			});
		} catch (e) {
			/* ignore */
		}
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

		s.add_fields = Array.from(
			new Set([...(s.add_fields || []), "pulse_last_seen_on", "pulse_presence_source"])
		);

		s.formatters = Object.assign({}, captured, {
			pulse_last_seen_on(value, df, doc) {
				if (captured.pulse_last_seen_on) {
					return captured.pulse_last_seen_on(value, df, doc);
				}
				return pulse_presence_badge_html(doc);
			},
		});

		s.onload = function (listview) {
			if (prev_onload) {
				prev_onload(listview);
			}
			try {
				listview.page.add_inner_button(__("Pulse help"), function () {
					frappe.msgprint({
						title: __("Pulse"),
						message: __(
							"Column «Pulse last seen»: Online/Away from Pulse. Empty = no recent mark_online. Show column via Menu → columns if hidden."
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

	window.jQuery(document).on("pulse_presence", function () {
		try {
			refresh_user_list_if_open();
			pulse_refresh_open_user_form_presence();
		} catch (e) {
			/* ignore */
		}
	});

	if (!window.__pulse_user_form_bound__) {
		window.__pulse_user_form_bound__ = true;
		frappe.ui.form.on("User", {
			refresh(frm) {
				try {
					if (!frm || !frm.doc || !frm.doc.name) {
						return;
					}
				} catch (e1) {
					return;
				}

				pulse_clear_user_form_pulse_ui(frm);

				frappe.call({
					method: "pulse_app.api.presence.desk_pulse_snapshot",
					args: { users: JSON.stringify([frm.doc.name]) },
					freeze: false,
					callback: function (r) {
						const row = (r.message || [])[0];
						const merged = row ? Object.assign({}, frm.doc, row) : frm.doc;

						let placed = false;
						function attempt(n) {
							pulse_clear_user_form_pulse_ui(frm);
							if (pulse_place_user_form_presence(frm, merged)) {
								placed = true;
								return;
							}
							if (n < 10) {
								setTimeout(function () {
									if (!placed) {
										attempt(n + 1);
									}
								}, 100 * (n + 1));
							}
						}
						attempt(0);
					},
					error: function () {
						let placed = false;
						function attempt(n) {
							pulse_clear_user_form_pulse_ui(frm);
							if (pulse_place_user_form_presence(frm, frm.doc)) {
								placed = true;
								return;
							}
							if (n < 5) {
								setTimeout(function () {
									if (!placed) {
										attempt(n + 1);
									}
								}, 150);
							}
						}
						attempt(0);
					},
				});
			},
		});
	}
})();
