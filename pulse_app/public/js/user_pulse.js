// User list: индикатор Online / Away по pulse_last_seen_on (окно совпадает с ONLINE_WINDOW_SEC в pulse service — 120 с).
const PULSE_ONLINE_WINDOW_SEC = 120;

frappe.listview_settings["User"] = {
	// чтобы doc.pulse_last_seen_on был в данных строки без ручного добавления колонки
	add_fields: ["pulse_last_seen_on"],
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
