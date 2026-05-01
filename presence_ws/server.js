"use strict";

const crypto = require("crypto");
const uWS = require("uwebsockets");
const redisPresence = require("./redis-presence");
const frappeVerify = require("./frappe-verify");
const { renderPrometheusText } = require("./prometheus-metrics");

const PORT = Number.parseInt(process.env.PORT || "8765", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
/** If set, GET /health, /online, /metrics require matching X-Api-Token or Authorization: Bearer. */
const PRESENCE_X_API_TOKEN = (
	process.env.PRESENCE_X_API_TOKEN ||
	process.env.METRICS_AUTH_TOKEN ||
	""
).trim();
const startedAt = Date.now();

/** Max length for optional client_service query (origin label). */
const CLIENT_SERVICE_MAX = 64;

/** @type {Map<string, { ws: object, connectedAt: number, address: string, userKey: string, clientService?: string }>} */
const clientsById = new Map();

let listenSocket = null;

function connectionCount() {
	return clientsById.size;
}

function uniqueLocalCount() {
	const keys = new Set();
	for (const meta of clientsById.values()) {
		keys.add(meta.userKey);
	}
	return keys.size;
}

function parseQueryUserId(req) {
	const raw = req.getQuery("user_id") || req.getQuery("sub");
	if (raw && String(raw).trim()) return String(raw).trim().slice(0, 512);
	return null;
}

/** Optional label: who connected (desk, mobile-app, …). Query: client_service, svc, from, service. */
function parseClientService(req) {
	const raw =
		req.getQuery("client_service") ||
		req.getQuery("svc") ||
		req.getQuery("from") ||
		req.getQuery("service");
	if (raw && String(raw).trim()) {
		return String(raw).trim().slice(0, CLIENT_SERVICE_MAX);
	}
	return "";
}

function remoteAddressText(req) {
	try {
		const t = req.getRemoteAddressAsText();
		if (t) {
			if (typeof t === "string") return t;
			const s = Buffer.from(t).toString("utf8");
			if (s) return s;
		}
		const bin = req.getRemoteAddress();
		if (bin && bin.byteLength === 4) {
			const u = new Uint8Array(bin);
			return `${u[0]}.${u[1]}.${u[2]}.${u[3]}`;
		}
	} catch {
		/* */
	}
	return "?";
}

function peerList() {
	const clients = [];
	for (const [sessionId, meta] of clientsById) {
		const row = {
			id: sessionId,
			session_id: sessionId,
			connectedAt: meta.connectedAt,
			address: meta.address,
			user_id: meta.userKey,
		};
		if (meta.clientService) row.client_service = meta.clientService;
		clients.push(row);
	}
	return clients;
}

/** Unique users = distinct user_id in the same rows as clients (matches frontend Set). */
function uniqueUsersFromClientRows(clients) {
	const set = new Set();
	for (const c of clients) {
		const id = c && c.user_id;
		if (id) set.add(id);
	}
	return set.size;
}

/** Stats per client_service tag (null = без метки). */
function aggregateServiceStats(clients) {
	/** @type {Map<string, { connections: number, users: Set<string> }>} */
	const m = new Map();
	for (const c of clients) {
		const raw = c && c.client_service;
		const key =
			raw && String(raw).trim()
				? String(raw).trim().slice(0, CLIENT_SERVICE_MAX)
				: "__none__";
		let bucket = m.get(key);
		if (!bucket) {
			bucket = { connections: 0, users: new Set() };
			m.set(key, bucket);
		}
		bucket.connections += 1;
		const uid = c && c.user_id;
		if (uid) bucket.users.add(uid);
	}
	const rows = [];
	for (const [key, b] of m) {
		rows.push({
			client_service: key === "__none__" ? null : key,
			connections: b.connections,
			unique_users: b.users.size,
		});
	}
	rows.sort((a, b) => {
		if (a.client_service == null && b.client_service == null) return 0;
		if (a.client_service == null) return 1;
		if (b.client_service == null) return -1;
		return /** @type {string} */ (a.client_service).localeCompare(
			/** @type {string} */ (b.client_service),
		);
	});
	return rows;
}

function extractServiceNames(service_stats) {
	return service_stats
		.filter((s) => s.client_service != null)
		.map((s) => /** @type {string} */ (s.client_service))
		.sort((a, b) => a.localeCompare(b));
}

/** @returns {string | "__none__" | undefined} undefined = без фильтра */
function parseOnlineServiceFilter(req) {
	const raw =
		(req.getQuery("client_service") || req.getQuery("svc") || "").trim();
	if (!raw) return undefined;
	const q = raw.slice(0, CLIENT_SERVICE_MAX);
	if (q === "__none__" || q === "_none" || q === "-") return "__none__";
	return q;
}

function filterClientsByService(clients, filterSpec) {
	if (filterSpec === "__none__") {
		return clients.filter(
			(c) => !c.client_service || !String(c.client_service).trim(),
		);
	}
	return clients.filter((c) => {
		const cs = c.client_service && String(c.client_service).trim();
		return cs === filterSpec;
	});
}

function buildOnlinePayload(req, clientsRaw, connectionsHint, source, redisStateStr) {
	const { tenant, service_id } = redisPresence.scope();

	const filterSpec = parseOnlineServiceFilter(req);
	const filtered = filterSpec !== undefined;
	const clients = filtered
		? filterClientsByService(clientsRaw, filterSpec)
		: clientsRaw;

	let connections;
	if (filtered) {
		connections = clients.length;
	} else {
		connections =
			connectionsHint != null ? connectionsHint : clientsRaw.length;
	}

	const unique_users = uniqueUsersFromClientRows(clients);

	const payload = {
		source,
		tenant,
		service_id,
		connections,
		unique_users,
		clients,
		redis: redisStateStr,
	};

	if (filtered) {
		payload.filter = {
			client_service:
				filterSpec === "__none__" ? null : filterSpec,
		};
	}

	return payload;
}

/** Только агрегаты по меткам + глобальные connections/unique_users (без списка сессий). */
function buildOnlineServicesPayload(
	clientsRaw,
	connectionsHint,
	source,
	redisStateStr,
) {
	const { tenant, service_id } = redisPresence.scope();
	const service_stats = aggregateServiceStats(clientsRaw);
	const services = extractServiceNames(service_stats);
	const connections =
		connectionsHint != null ? connectionsHint : clientsRaw.length;
	const unique_users = uniqueUsersFromClientRows(clientsRaw);
	return {
		source,
		tenant,
		service_id,
		connections,
		unique_users,
		services,
		service_stats,
		redis: redisStateStr,
	};
}

/**
 * Компактная сводка: total + по каждой метке (массив breakdown и объект by_service).
 * У сессий без client_service ключ в by_service: "_untagged".
 */
function buildOnlineSummaryPayload(
	clientsRaw,
	connectionsHint,
	source,
	redisStateStr,
) {
	const { tenant, service_id } = redisPresence.scope();
	const breakdown = aggregateServiceStats(clientsRaw);
	/** @type {Record<string, { connections: number, unique_users: number }>} */
	const by_service = {};
	for (const row of breakdown) {
		const key =
			row.client_service == null ? "_untagged" : row.client_service;
		by_service[key] = {
			connections: row.connections,
			unique_users: row.unique_users,
		};
	}
	const connections =
		connectionsHint != null ? connectionsHint : clientsRaw.length;
	const unique_users = uniqueUsersFromClientRows(clientsRaw);
	return {
		source,
		tenant,
		service_id,
		total: {
			connections,
			unique_users,
		},
		breakdown,
		by_service,
		redis: redisStateStr,
	};
}

function healthPayload() {
	const { tenant, service_id } = redisPresence.scope();
	const local = connectionCount();
	return {
		status: "ok",
		service: "presence-ws",
		connections: local,
		tenant,
		service_id,
		redis: redisPresence.redisState(),
		connections_local: local,
	};
}

async function healthPayloadAsync() {
	const payload = healthPayload();
	const onlineRedis = await redisPresence.countOnline();
	const uniqRedis = await redisPresence.countUniqueUsers();
	if (onlineRedis !== null) {
		payload.connections = onlineRedis;
		payload.connections_redis = onlineRedis;
	}
	payload.unique_users =
		uniqRedis !== null ? uniqRedis : uniqueLocalCount();
	return payload;
}

function jsonHttp(res, obj, status = "200 OK") {
	res.writeStatus(status);
	res.writeHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(obj));
}

function prometheusHttp(res, body, status = "200 OK") {
	res.writeStatus(status);
	res.writeHeader(
		"Content-Type",
		"text/plain; version=0.0.4; charset=utf-8",
	);
	const t = typeof body === "string" ? body : String(body);
	res.end(t.endsWith("\n") ? t : `${t}\n`);
}

function parseXApiToken(req) {
	const bearer = (req.getHeader("authorization") || "").trim();
	const m = /^Bearer\s+(.+)$/i.exec(bearer);
	if (m) return m[1].trim();
	const x = (req.getHeader("x-api-token") || "").trim();
	if (x) return x;
	return (req.getHeader("x-metrics-token") || "").trim();
}

function assertGetAuthorized(req, res) {
	if (!PRESENCE_X_API_TOKEN) return true;
	if (parseXApiToken(req) !== PRESENCE_X_API_TOKEN) {
		res.cork(() =>
			jsonHttp(res, { ok: false, error: "forbidden" }, "403 Forbidden"),
		);
		return false;
	}
	return true;
}

function parseAdminToken(req) {
	const bearer = (req.getHeader("authorization") || "").trim();
	const m = /^Bearer\s+(.+)$/i.exec(bearer);
	if (m) return m[1].trim();
	return (req.getHeader("x-admin-token") || "").trim();
}

/** Read small JSON POST body (uWebSockets: req invalid after return). */
function readJsonBody(res, maxBytes, onJson, onFail) {
	let buffer;
	let total = 0;
	let settled = false;
	function fail(err) {
		if (settled) return;
		settled = true;
		onFail(err);
	}
	res.onAborted(() => fail(new Error("aborted")));
	res.onData((ab, isLast) => {
		if (settled) return;
		const chunk = Buffer.from(ab);
		total += chunk.length;
		if (total > maxBytes) {
			fail(new Error("too_large"));
			return;
		}
		if (isLast) {
			const raw = buffer ? Buffer.concat([buffer, chunk]) : chunk;
			const text = raw.length ? raw.toString("utf8").trim() : "{}";
			try {
				const obj = JSON.parse(text || "{}");
				if (settled) return;
				settled = true;
				onJson(obj);
			} catch (e) {
				fail(e);
			}
		} else {
			buffer = buffer ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
		}
	});
}

function kickSessionById(sessionId) {
	const meta = clientsById.get(sessionId);
	if (!meta) return { ok: false, notFound: true };
	try {
		sendWsJson(meta.ws, { event: "bye", reason: "kick" });
		meta.ws.end(1000, "kick");
	} catch {
		return { ok: false, error: "close_failed" };
	}
	return { ok: true };
}

function kickAllSessions() {
	let n = 0;
	for (const meta of Array.from(clientsById.values())) {
		try {
			sendWsJson(meta.ws, { event: "bye", reason: "kickAll" });
			meta.ws.end(1000, "kickAll");
			n++;
		} catch {
			/* */
		}
	}
	return n;
}

function assertAdminHttp(req, res) {
	if (!ADMIN_TOKEN) {
		res.cork(() =>
			jsonHttp(
				res,
				{ ok: false, error: "admin_disabled" },
				"503 Service Unavailable",
			),
		);
		return false;
	}
	if (parseAdminToken(req) !== ADMIN_TOKEN) {
		res.cork(() =>
			jsonHttp(res, { ok: false, error: "forbidden" }, "403 Forbidden"),
		);
		return false;
	}
	return true;
}

function sendWsJson(ws, obj) {
	try {
		ws.send(JSON.stringify(obj), false);
	} catch {
		/* */
	}
}

function sendError(ws, message) {
	sendWsJson(ws, { event: "error", message });
}

function broadcastExcept(exceptWs, payload) {
	const data = JSON.stringify(payload);
	for (const meta of clientsById.values()) {
		if (meta.ws === exceptWs) continue;
		try {
			meta.ws.send(data, false);
		} catch {
			/* */
		}
	}
}

async function handleCommand(ws, cmdRaw, payload) {
	const cmd = String(cmdRaw || "")
		.trim()
		.toLowerCase();

	if (cmd === "info") {
		let clients;
		let connections;
		let unique_users;
		if (redisPresence.ready()) {
			clients = await redisPresence.listOnline();
			connections = (await redisPresence.countOnline()) ?? clients.length;
			unique_users =
				(await redisPresence.countUniqueUsers()) ?? uniqueLocalCount();
		} else {
			clients = peerList();
			connections = connectionCount();
			unique_users = uniqueLocalCount();
		}
		sendWsJson(ws, {
			event: "info",
			service: "presence-ws",
			alive: true,
			connections,
			unique_users,
			uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
			clients,
			redis: redisPresence.redisState(),
		});
		return;
	}

	if (cmd === "stats") {
		let connections;
		let unique_users;
		if (redisPresence.ready()) {
			connections =
				(await redisPresence.countOnline()) ?? connectionCount();
			unique_users =
				(await redisPresence.countUniqueUsers()) ?? uniqueLocalCount();
		} else {
			connections = connectionCount();
			unique_users = uniqueLocalCount();
		}
		sendWsJson(ws, {
			event: "stats",
			alive: true,
			connections,
			unique_users,
			uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
			redis: redisPresence.redisState(),
		});
		return;
	}

	const adminish =
		cmd === "kick" ||
		cmd === "kickall" ||
		cmd === "kick_all";
	if (adminish) {
		sendError(
			ws,
			"admin: use HTTP POST /admin/kick or /admin/kick-all (header X-Admin-Token or Authorization: Bearer)",
		);
		return;
	}
}

function copyWsUpgradeHeaders(req) {
	return {
		secWebSocketKey: req.getHeader("sec-websocket-key"),
		secWebSocketProtocol: req.getHeader("sec-websocket-protocol"),
		secWebSocketExtensions: req.getHeader("sec-websocket-extensions"),
	};
}

function commitWsUpgrade(res, context, userKey, headers, address, clientService) {
	const sessionId = crypto.randomUUID();
	const connectedAt = Date.now();
	const cs =
		clientService && String(clientService).trim()
			? String(clientService).trim().slice(0, CLIENT_SERVICE_MAX)
			: "";
	res.upgrade(
		{
			sessionId,
			userKey,
			address,
			connectedAt,
			clientService: cs,
		},
		headers.secWebSocketKey,
		headers.secWebSocketProtocol,
		headers.secWebSocketExtensions,
		context,
	);
}

function onClientMessage(ws, text) {
	const trimmed = text.trim();
	if (!trimmed) return;

	if (/^info$/i.test(trimmed)) {
		void handleCommand(ws, "info", {});
		return;
	}
	if (/^stats$/i.test(trimmed)) {
		void handleCommand(ws, "stats", {});
		return;
	}

	let payload;
	try {
		payload = JSON.parse(trimmed);
	} catch {
		return;
	}

	if (!payload || typeof payload !== "object") return;

	const cmd = payload.cmd || payload.command;
	if (cmd === undefined && payload.action) {
		void handleCommand(ws, payload.action, payload);
		return;
	}
	void handleCommand(ws, cmd, payload);
}

/** Локальный GET — короткие пути для nginx (`/_presence/overview`, без конфликта с `/online/...`). */
function httpGetOnlineSummary(res, req) {
	if (!assertGetAuthorized(req, res)) return;
	let aborted = false;
	res.onAborted(() => {
		aborted = true;
	});
	if (!redisPresence.ready()) {
		const clientsRaw = peerList();
		jsonHttp(
			res,
			buildOnlineSummaryPayload(
				clientsRaw,
				clientsRaw.length,
				"local",
				redisPresence.redisState(),
			),
		);
		return;
	}
	Promise.all([
		redisPresence.listOnline(),
		redisPresence.countOnline(),
	])
		.then(([clientsRaw, n]) => {
			if (aborted) return;
			jsonHttp(
				res,
				buildOnlineSummaryPayload(
					clientsRaw,
					n ?? clientsRaw.length,
					"redis",
					redisPresence.redisState(),
				),
			);
		})
		.catch(() => {
			if (aborted) return;
			jsonHttp(res, { status: "error" }, "500 Internal Server Error");
		});
}

function httpGetOnlineServices(res, req) {
	if (!assertGetAuthorized(req, res)) return;
	let aborted = false;
	res.onAborted(() => {
		aborted = true;
	});
	if (!redisPresence.ready()) {
		const clientsRaw = peerList();
		jsonHttp(
			res,
			buildOnlineServicesPayload(
				clientsRaw,
				clientsRaw.length,
				"local",
				redisPresence.redisState(),
			),
		);
		return;
	}
	Promise.all([
		redisPresence.listOnline(),
		redisPresence.countOnline(),
	])
		.then(([clientsRaw, n]) => {
			if (aborted) return;
			jsonHttp(
				res,
				buildOnlineServicesPayload(
					clientsRaw,
					n ?? clientsRaw.length,
					"redis",
					redisPresence.redisState(),
				),
			);
		})
		.catch(() => {
			if (aborted) return;
			jsonHttp(res, { status: "error" }, "500 Internal Server Error");
		});
}

/** GET /online и GET /list — список clients, фильтры ?client_service / ?svc */
function httpGetOnline(res, req) {
	if (!assertGetAuthorized(req, res)) return;
	let aborted = false;
	res.onAborted(() => {
		aborted = true;
	});
	if (!redisPresence.ready()) {
		const clientsRaw = peerList();
		jsonHttp(
			res,
			buildOnlinePayload(
				req,
				clientsRaw,
				clientsRaw.length,
				"local",
				redisPresence.redisState(),
			),
		);
		return;
	}
	Promise.all([
		redisPresence.listOnline(),
		redisPresence.countOnline(),
	])
		.then(([clientsRaw, n]) => {
			if (aborted) return;
			jsonHttp(
				res,
				buildOnlinePayload(
					req,
					clientsRaw,
					n ?? clientsRaw.length,
					"redis",
					redisPresence.redisState(),
				),
			);
		})
		.catch(() => {
			if (aborted) return;
			jsonHttp(res, { status: "error" }, "500 Internal Server Error");
		});
}

function httpPostAdminKick(res, req) {
	if (!assertAdminHttp(req, res)) return;
	readJsonBody(
		res,
		8192,
		(obj) => {
			const sid =
				obj &&
				(obj.session_id || obj.id || obj.clientId || obj.target);
			if (!sid || typeof sid !== "string") {
				res.cork(() =>
					jsonHttp(
						res,
						{ ok: false, error: "session_id required" },
						"400 Bad Request",
					),
				);
				return;
			}
			const id = sid.trim();
			const r = kickSessionById(id);
			if (r.notFound) {
				res.cork(() =>
					jsonHttp(
						res,
						{ ok: false, error: "not_found", session_id: id },
						"404 Not Found",
					),
				);
				return;
			}
			if (!r.ok) {
				res.cork(() =>
					jsonHttp(
						res,
						{ ok: false, error: r.error || "kick_failed" },
						"500 Internal Server Error",
					),
				);
				return;
			}
			res.cork(() => jsonHttp(res, { ok: true, session_id: id }));
		},
		(err) => {
			if (err && err.message === "aborted") return;
			const status =
				err && err.message === "too_large"
					? "413 Payload Too Large"
					: "400 Bad Request";
			const code =
				err && err.message === "too_large" ? "too_large" : "invalid_json";
			res.cork(() =>
				jsonHttp(res, { ok: false, error: code }, status),
			);
		},
	);
}

function httpPostAdminKickAll(res, req) {
	if (!assertAdminHttp(req, res)) return;
	const cl = Number.parseInt(req.getHeader("content-length") || "0", 10);
	if (!cl || cl <= 0) {
		const n = kickAllSessions();
		res.cork(() => jsonHttp(res, { ok: true, disconnected: n }));
		return;
	}
	readJsonBody(
		res,
		256,
		() => {
			const n = kickAllSessions();
			res.cork(() => jsonHttp(res, { ok: true, disconnected: n }));
		},
		(err) => {
			if (err && err.message === "aborted") return;
			const status =
				err && err.message === "too_large"
					? "413 Payload Too Large"
					: "400 Bad Request";
			const code =
				err && err.message === "too_large" ? "too_large" : "invalid_json";
			res.cork(() =>
				jsonHttp(res, { ok: false, error: code }, status),
			);
		},
	);
}

const app = uWS
	.App()
	.get("/health", (res, req) => {
		if (!assertGetAuthorized(req, res)) return;
		let aborted = false;
		res.onAborted(() => {
			aborted = true;
		});
		healthPayloadAsync()
			.then((payload) => {
				if (aborted) return;
				jsonHttp(res, payload);
			})
			.catch(() => {
				if (aborted) return;
				jsonHttp(res, { status: "error" }, "500 Internal Server Error");
			});
	})
	.get("/metrics", (res, req) => {
		if (!assertGetAuthorized(req, res)) return;
		let aborted = false;
		res.onAborted(() => {
			aborted = true;
		});
		healthPayloadAsync()
			.then((payload) => {
				if (aborted) return;
				const text = renderPrometheusText(payload, {
					uptimeSec: (Date.now() - startedAt) / 1000,
					redisReady: redisPresence.ready(),
					frappeVerifyEnabled: frappeVerify.isEnabled(),
					adminHttpEnabled: Boolean(ADMIN_TOKEN),
				});
				res.cork(() => {
					if (aborted) return;
					prometheusHttp(res, text);
				});
			})
			.catch(() => {
				if (aborted) return;
				res.cork(() => {
					if (aborted) return;
					prometheusHttp(
						res,
						[
							"# HELP presence_ws_scrape_error 1 if /metrics could not read presence state.",
							"# TYPE presence_ws_scrape_error gauge",
							"presence_ws_scrape_error 1",
							"",
						].join("\n"),
						"500 Internal Server Error",
					);
				});
			});
	})
	/* Компактная сводка по меткам: предпочитай /overview за nginx — путь "summary" часто режется Frappe/прокси. */
	.get("/overview", httpGetOnlineSummary)
	.get("/summary", httpGetOnlineSummary)
	.get("/stats", httpGetOnlineSummary)
	.get("/services", httpGetOnlineServices)
	.get("/list", httpGetOnline)
	.get("/online", httpGetOnline)
	.post("/kick", httpPostAdminKick)
	.post("/kick-all", httpPostAdminKickAll)
	.post("/admin/kick", httpPostAdminKick)
	.post("/admin/kick-all", httpPostAdminKickAll)
	.ws("/*", {
		compression: uWS.SHARED_COMPRESSOR,
		maxPayloadLength: 64 * 1024,
		idleTimeout: 120,
		upgrade: (res, req, context) => {
			const headers = copyWsUpgradeHeaders(req);
			const address = remoteAddressText(req);
			const clientService = parseClientService(req);

			if (!frappeVerify.isEnabled()) {
				const userKey = parseQueryUserId(req);
				if (!userKey) {
					console.log(
						"REJECT",
						address,
						"missing user_id or sub",
					);
					res.writeStatus("403 Forbidden");
					res.end("user_id or sub query parameter required");
					return;
				}
				commitWsUpgrade(
					res,
					context,
					userKey,
					headers,
					address,
					clientService,
				);
				return;
			}

			const ticket = (req.getQuery("ticket") || "").trim().slice(0, 200);
			const sidFromQuery = (req.getQuery("sid") || "").trim().slice(0, 128);
			const cookie = req.getHeader("cookie") || "";
			const sid =
				sidFromQuery || frappeVerify.parseSidFromCookie(cookie) || "";

			let aborted = false;
			res.onAborted(() => {
				aborted = true;
			});

			frappeVerify
				.verifyUpgrade({ sid, ticket })
				.then((result) => {
					if (aborted) return;
					if (!result.ok) {
						res.cork(() => {
							if (aborted) return;
							res.writeStatus(result.status);
							res.end(result.body);
						});
						return;
					}
					res.cork(() => {
						if (aborted) return;
						commitWsUpgrade(
							res,
							context,
							result.userKey,
							headers,
							address,
							clientService,
						);
					});
				})
				.catch(() => {
					if (aborted) return;
					res.cork(() => {
						if (aborted) return;
						res.writeStatus("502 Bad Gateway");
						res.end("Frappe verify error");
					});
				});
		},
		open: (ws) => {
			const d = ws.getUserData();
			const sessionId = d.sessionId;
			const userKey = d.userKey;
			const address = d.address;
			const connectedAt = d.connectedAt;
			const clientService = d.clientService || "";

			const meta = {
				ws,
				connectedAt,
				address,
				userKey,
			};
			if (clientService) meta.clientService = clientService;
			clientsById.set(sessionId, meta);

			console.log(
				"CONNECT",
				address,
				sessionId,
				userKey,
				clientService || "-",
				"total",
				connectionCount(),
			);

			const redisMeta = {
				connectedAt,
				address,
				user_id: userKey,
			};
			if (clientService) redisMeta.client_service = clientService;

			redisPresence
				.recordConnect(sessionId, redisMeta)
				.catch((e) => console.error("redis recordConnect", e.message));

			const welcome = {
				event: "welcome",
				message: "presence-ws",
				session_id: sessionId,
				clientId: sessionId,
				user_id: userKey,
			};
			if (clientService) welcome.client_service = clientService;
			sendWsJson(ws, welcome);

			const join = {
				event: "join",
				session_id: sessionId,
				clientId: sessionId,
				user_id: userKey,
			};
			if (clientService) join.client_service = clientService;
			broadcastExcept(ws, join);
		},
		message: (ws, message, isBinary) => {
			if (isBinary) return;
			const text = Buffer.from(message).toString("utf8");
			onClientMessage(ws, text);
		},
		close: (ws) => {
			const d = ws.getUserData();
			const sid = d.sessionId;
			const uk = d.userKey;
			const address = d.address;
			const clientService = d.clientService || "";
			clientsById.delete(sid);
			redisPresence
				.recordDisconnect(sid)
				.catch((e) => console.error("redis recordDisconnect", e.message));
			const leave = {
				event: "leave",
				session_id: sid,
				clientId: sid,
				user_id: uk,
			};
			if (clientService) leave.client_service = clientService;
			broadcastExcept(ws, leave);
			console.log(
				"DISCONNECT",
				address,
				sid,
				uk,
				"total",
				connectionCount(),
			);
		},
	})
	.any("/*", (res) => {
		res.writeStatus("404 Not Found");
		res.writeHeader("Content-Type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ ok: false, error: "not_found" }));
	});

function shutdown(signal) {
	console.log(signal, "shutting down");
	if (listenSocket) {
		uWS.us_listen_socket_close(listenSocket);
		listenSocket = null;
	}
	redisPresence.quit().finally(() => process.exit(0));
	setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

(async () => {
	try {
		await redisPresence.connect();
	} catch (e) {
		console.error(e);
		process.exit(1);
	}

	app.listen(HOST, PORT, (token) => {
		listenSocket = token;
		if (!token) {
			console.error("failed to listen");
			process.exit(1);
			return;
		}
		const rs = redisPresence.redisState();
		console.log(
			`presence-ws uWebSockets.js http://${HOST}:${PORT} health=/health metrics=/metrics online=/online get_auth=${PRESENCE_X_API_TOKEN ? "on" : "off"} admin_http=${ADMIN_TOKEN ? "on" : "off"} redis=${rs} frappe_verify=${frappeVerify.isEnabled() ? "on" : "off"}`,
		);
	});
})();
