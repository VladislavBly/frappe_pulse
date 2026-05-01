"use strict";

function escLabel(s) {
	return String(s ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/"/g, '\\"');
}

function labelSet(parts) {
	const keys = Object.keys(parts);
	if (!keys.length) return "";
	const inner = keys
		.map((k) => `${k}="${escLabel(parts[k])}"`)
		.join(",");
	return `{${inner}}`;
}

/**
 * @param {object} h — результат healthPayloadAsync()
 * @param {object} opts
 * @param {number} opts.uptimeSec
 * @param {boolean} opts.redisReady
 * @param {boolean} opts.frappeVerifyEnabled
 * @param {boolean} opts.adminHttpEnabled
 */
function renderPrometheusText(h, opts) {
	const tenant = h.tenant || "default";
	const service_id = h.service_id || "presence-ws";
	const L = labelSet({ tenant, service_id });
	const uptime = Math.max(0, Math.floor(Number(opts.uptimeSec) || 0));
	const conn = Math.max(0, Number(h.connections) || 0);
	const connLocalRaw = h.connections_local;
	const connLocal = Number.isFinite(Number(connLocalRaw))
		? Math.max(0, Number(connLocalRaw))
		: conn;
	const uniq = Math.max(0, Number(h.unique_users) || 0);
	const redis = opts.redisReady ? 1 : 0;
	const fv = opts.frappeVerifyEnabled ? 1 : 0;
	const adm = opts.adminHttpEnabled ? 1 : 0;

	const lines = [
		"# HELP presence_ws_up The presence-ws process answered this scrape (always 1 on 200).",
		"# TYPE presence_ws_up gauge",
		`presence_ws_up${L} 1`,
		"",
		"# HELP presence_ws_uptime_seconds Uptime of the Node process in seconds.",
		"# TYPE presence_ws_uptime_seconds gauge",
		`presence_ws_uptime_seconds${L} ${uptime}`,
		"",
		"# HELP presence_ws_connections Current WebSocket connections (cluster-wide from Redis when connected, else local).",
		"# TYPE presence_ws_connections gauge",
		`presence_ws_connections${L} ${conn}`,
		"",
		"# HELP presence_ws_connections_local Connections accepted on this node only.",
		"# TYPE presence_ws_connections_local gauge",
		`presence_ws_connections_local${L} ${connLocal}`,
		"",
		"# HELP presence_ws_unique_users Distinct user_id values in presence (Redis when available).",
		"# TYPE presence_ws_unique_users gauge",
		`presence_ws_unique_users${L} ${uniq}`,
		"",
		"# HELP presence_ws_redis_connected 1 if Redis client is connected and used for presence.",
		"# TYPE presence_ws_redis_connected gauge",
		`presence_ws_redis_connected${L} ${redis}`,
		"",
		"# HELP presence_ws_frappe_upgrade_verify_enabled 1 if Frappe upgrade verification is active (URL+secret and FRAPPE_PRESENCE_VERIFY_ENABLED not off).",
		"# TYPE presence_ws_frappe_upgrade_verify_enabled gauge",
		`presence_ws_frappe_upgrade_verify_enabled${L} ${fv}`,
		"",
		"# HELP presence_ws_admin_http_enabled 1 if ADMIN_TOKEN is set (HTTP /admin/kick*).",
		"# TYPE presence_ws_admin_http_enabled gauge",
		`presence_ws_admin_http_enabled${L} ${adm}`,
		"",
	];
	return lines.join("\n");
}

module.exports = { renderPrometheusText };
