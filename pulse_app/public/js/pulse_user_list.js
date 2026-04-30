// Список User: индикатор Online / Away по pulse_last_seen_on и окну из boot; обновление по pulse_presence.

frappe.provide("pulse");

pulse._userListPresenceWindowSec = function () {
	var p = frappe.boot && frappe.boot.pulse;
	var w = p && p.user_list_online_window_sec;
	var n = parseInt(w, 10);
	return !isNaN(n) && n > 0 ? n : 120;
};

pulse._parseUserPulseTs = function (v) {
	if (!v) {
		return null;
	}
	if (typeof frappe.datetime.str_to_obj === "function") {
		try {
			var o = frappe.datetime.str_to_obj(v);
			if (o && !isNaN(o.getTime())) {
				return o;
			}
		} catch (e) {
			/* fall through */
		}
	}
	var d = new Date(v);
	return isNaN(d.getTime()) ? null : d;
};

(function () {
	var prev = frappe.listview_settings.User || {};
	var prevFields = prev.add_fields || [];
	var mergedFields = prevFields.slice();
	if (mergedFields.indexOf("pulse_last_seen_on") === -1) {
		mergedFields.push("pulse_last_seen_on");
	}

	function pulseIndicator(doc) {
		var ls = doc.pulse_last_seen_on;
		if (!ls) {
			return null;
		}
		var seen = pulse._parseUserPulseTs(ls);
		if (!seen) {
			return null;
		}
		var windowSec = pulse._userListPresenceWindowSec();
		var ageSec = (Date.now() - seen.getTime()) / 1000;
		if (ageSec <= windowSec) {
			return [__("Online"), "green", "pulse_presence=online"];
		}
		return [__("Away"), "orange", "pulse_presence=away"];
	}

	frappe.listview_settings.User = $.extend({}, prev, {
		add_fields: mergedFields,

		get_indicator: function (doc) {
			var ind = pulseIndicator(doc);
			if (ind) {
				return ind;
			}
			return prev.get_indicator ? prev.get_indicator(doc) : null;
		},
	});

	$(document).off("pulse_presence.pulseUserList").on("pulse_presence.pulseUserList", function () {
		if (typeof cur_list === "undefined" || !cur_list || cur_list.doctype !== "User") {
			return;
		}
		try {
			cur_list.refresh();
		} catch (e) {
			/* ignore */
		}
	});
})();
