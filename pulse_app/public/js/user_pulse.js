// User list + form: Pulse Online / Away / No data (окно 120 с — как ONLINE_WINDOW_SEC в service.py).
(function () {
	const PULSE_ONLINE_WINDOW_SEC = 120;

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

	const prev = frappe.listview_settings.User || {};
	const prev_fmt = prev.formatters || {};
	const prev_get_indicator = prev.get_indicator;

	frappe.listview_settings.User = Object.assign({}, prev, {
		add_fields: Array.from(
			new Set([...(prev.add_fields || []), "pulse_last_seen_on", "pulse_presence_source"])
		),

		formatters: Object.assign({}, prev_fmt, {
			full_name(value, df, doc) {
				let html;
				if (prev_fmt.full_name) {
					html = prev_fmt.full_name(value, df, doc);
				} else {
					html = frappe.utils.escape_html(value || doc.name || "");
				}
				return `${html} &nbsp;${pulse_presence_badge_html(doc)}`;
			},
			pulse_last_seen_on(value, df, doc) {
				if (prev_fmt.pulse_last_seen_on) {
					return prev_fmt.pulse_last_seen_on(value, df, doc);
				}
				return pulse_presence_badge_html(doc);
			},
		}),

		get_indicator(doc) {
			const mine = pulse_get_indicator(doc);
			if (mine) {
				return mine;
			}
			if (prev_get_indicator) {
				return prev_get_indicator(doc);
			}
		},
	});

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
