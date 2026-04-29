// User list: Pulse last seen + явный текст Online / Away / No data.
// Окно времени как в pulse service (ONLINE_WINDOW_SEC = 120).
const PULSE_ONLINE_WINDOW_SEC = 120;

frappe.listview_settings["User"] = {
	add_fields: ["pulse_last_seen_on"],

	formatters: {
		pulse_last_seen_on(value, _df, doc) {
			if (!value) {
				return `<span class="indicator-pill no-indicator ellipsis">${frappe.utils.escape_html(__("No Pulse"))}</span>`;
			}
			const t = new Date(value).getTime();
			if (Number.isNaN(t)) {
				return frappe.utils.escape_html(value);
			}
			const sec = (Date.now() - t) / 1000;
			const online = sec >= 0 && sec <= PULSE_ONLINE_WINDOW_SEC;
			const label = online ? __("Online") : __("Away");
			const color = online ? "green" : "gray";
			const time = frappe.datetime.str_to_user
				? frappe.datetime.str_to_user(value)
				: value;
			return `<span class="indicator-pill ${color}">${frappe.utils.escape_html(label)} · ${frappe.utils.escape_html(time)}</span>`;
		},
	},

	get_indicator(doc) {
		if (!doc.pulse_last_seen_on) {
			return;
		}
		const t = new Date(doc.pulse_last_seen_on).getTime();
		if (Number.isNaN(t)) {
			return;
		}
		const sec = (Date.now() - t) / 1000;
		if (sec >= 0 && sec <= PULSE_ONLINE_WINDOW_SEC) {
			return [__("Online"), "green", "pulse_last_seen_on"];
		}
		return [__("Away"), "gray", "pulse_last_seen_on"];
	},
};
