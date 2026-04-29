// User list + form: Pulse в колонке pulse_last_seen_on; форма — баннер / сайдбар / заголовок.
//
// Важно: ERPNext/другие приложения часто перезаписывают frappe.listview_settings.User ПОСЛЕ pulse_app.
// Поэтому помимо глобальных настроек патчим frappe.views.ListView (setup_view), чтобы поля/formatters
// подмешивались при каждом открытии списка User.

(function () {
	const PULSE_ONLINE_WINDOW_SEC = 120;
	const MERGE_REV = 8;
	window.__pulse_app_user_js = "0.1.3";

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

	/** Подмешать поля и formatter в глобальные настройки списка User (идемпотентно по ключам). */
	function pulse_merge_user_listview_globals() {
		frappe.provide("frappe.listview_settings.User");
		const g = frappe.listview_settings.User;
		g.add_fields = Array.from(
			new Set([...(g.add_fields || []), "pulse_last_seen_on", "pulse_presence_source"])
		);
		const pulseFmt = {
			pulse_last_seen_on(value, df, doc) {
				if (df && df.fieldname && df.fieldname !== "pulse_last_seen_on") {
					return value;
				}
				return pulse_presence_badge_html(doc);
			},
		};
		g.formatters = Object.assign({}, g.formatters || {}, pulseFmt);

		if (!g.__pulse_onload_installed) {
			g.__pulse_onload_installed = true;
			const prev_onload = g.onload;
			g.onload = function (listview) {
				if (prev_onload) {
					prev_onload(listview);
				}
				try {
					listview.page.add_inner_button(__("Pulse help"), function () {
						frappe.msgprint({
							title: __("Pulse"),
							message: __(
								"Колонка «Pulse last seen». Если скрыта — меню списка → Columns. Онлайн только после mark_online с клиента."
							),
							indicator: "blue",
						});
					});
				} catch (e) {
					/* ignore */
				}
				if (listview.doctype === "User") {
					const strip = function () {
						try {
							if (listview.$result && listview.$result.length) {
								listview.$result.find(".pulse-user-badge-slot").remove();
							}
						} catch (e2) {
							/* ignore */
						}
					};
					strip();
					[80, 400, 1000].forEach(function (ms) {
						setTimeout(strip, ms);
					});
					if (typeof listview.refresh === "function" && !listview.__pulse_strip_refresh_bound) {
						listview.__pulse_strip_refresh_bound = true;
						const origRefresh = listview.refresh;
						listview.refresh = function () {
							const out = origRefresh.apply(this, arguments);
							try {
								if (out && typeof out.then === "function") {
									out.then(strip);
								} else {
									setTimeout(strip, 0);
								}
							} catch (e3) {
								setTimeout(strip, 0);
							}
							return out;
						};
					}
				}
			};
		}

		g._pulse_rev = MERGE_REV;
		try {
			if (window.cur_list && cur_list.doctype === "User") {
				cur_list.settings = g;
			}
		} catch (e) {
			/* ignore */
		}
	}

	function pulse_try_patch_listview_prototype() {
		if (window.__pulse_listview_prototype_patched) {
			return true;
		}
		const LV = frappe.views && frappe.views.ListView;
		if (!LV || !LV.prototype) {
			return false;
		}

		function wrap_method(methodName) {
			const orig = LV.prototype[methodName];
			if (typeof orig !== "function" || orig.__pulse_lv_wrap) {
				return false;
			}
			LV.prototype[methodName] = function () {
				if (this.doctype === "User") {
					pulse_merge_user_listview_globals();
				}
				const ret = orig.apply(this, arguments);
				if (this.doctype === "User") {
					pulse_merge_user_listview_globals();
					try {
						this.settings = frappe.listview_settings.User;
					} catch (e) {
						/* ignore */
					}
				}
				return ret;
			};
			LV.prototype[methodName].__pulse_lv_wrap = true;
			return true;
		}

		let ok = false;
		["setup_view", "render_list", "refresh"].forEach(function (name) {
			if (wrap_method(name)) {
				ok = true;
			}
		});

		if (!ok) {
			return false;
		}
		window.__pulse_listview_prototype_patched = true;
		return true;
	}

	function pulse_schedule_listview_patch_attempts() {
		if (pulse_try_patch_listview_prototype()) {
			return;
		}
		[50, 200, 600, 1500, 4000].forEach(function (ms) {
			setTimeout(function () {
				pulse_try_patch_listview_prototype();
			}, ms);
		});
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

	function pulse_inject_user_form_main_banner(frm, doc) {
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

		let $scope = frm.wrapper;
		if (frm.page && frm.page.wrapper && frm.page.wrapper.length) {
			$scope = $scope.add(frm.page.wrapper);
		}
		let $head = $scope.find(".page-head").first();
		if (!$head.length && frm.page && frm.page.page_container) {
			$head = frm.page.page_container.find(".page-head").first();
		}
		if ($head.length) {
			$head.first().after(block);
			return true;
		}

		const $main = frm.wrapper
			.find(".layout-main-section, .layout-main .layout-main-section, .form-page, .form-layout")
			.first();
		if ($main.length) {
			const $innerHead = $main.find(".page-head").first();
			if ($innerHead.length) {
				$innerHead.after(block);
				return true;
			}
			$main.prepend(block);
			return true;
		}

		const $body = frm.wrapper.find(".page-body, .form-column, .main-section").first();
		if ($body.length) {
			$body.prepend(block);
			return true;
		}

		return false;
	}

	function pulse_inject_user_form_sidebar_badge(frm, doc) {
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

	let pulse_form_refresh_timer = null;
	function pulse_refresh_open_user_form_presence() {
		try {
			if (!window.cur_frm || cur_frm.doctype !== "User" || !cur_frm.doc || !cur_frm.doc.name) {
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

	function pulse_debounced_form_presence() {
		if (pulse_form_refresh_timer) {
			clearTimeout(pulse_form_refresh_timer);
		}
		pulse_form_refresh_timer = setTimeout(pulse_refresh_open_user_form_presence, 400);
	}

	function refresh_user_list_if_open() {
		try {
			if (window.cur_list && cur_list.doctype === "User" && cur_list.refresh) {
				cur_list.refresh();
			}
		} catch (e) {
			/* ignore */
		}
	}

	pulse_merge_user_listview_globals();
	pulse_schedule_listview_patch_attempts();

	frappe.ready(function () {
		pulse_merge_user_listview_globals();
		pulse_schedule_listview_patch_attempts();
		refresh_user_list_if_open();
		[50, 400, 1200, 3000].forEach(function (ms) {
			setTimeout(function () {
				pulse_merge_user_listview_globals();
				pulse_try_patch_listview_prototype();
				refresh_user_list_if_open();
			}, ms);
		});
	});

	if (frappe.router && typeof frappe.router.on === "function") {
		frappe.router.on("change", function () {
			pulse_merge_user_listview_globals();
			pulse_try_patch_listview_prototype();
			frappe.after_ajax &&
				frappe.after_ajax(function () {
					pulse_merge_user_listview_globals();
					refresh_user_list_if_open();
					pulse_debounced_form_presence();
				});
			[300, 1200].forEach(function (ms) {
				setTimeout(function () {
					pulse_merge_user_listview_globals();
					pulse_refresh_open_user_form_presence();
				}, ms);
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
							if (n < 12) {
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
							if (n < 6) {
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
