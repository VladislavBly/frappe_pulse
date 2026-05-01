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

/** @type {Map<string, { ws: object, connectedAt: number, address: string, userKey: string }>} */
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
		clients.push({
			id: sessionId,
			session_id: sessionId,
			connectedAt: meta.connectedAt,
			address: meta.address,
			user_id: meta.userKey,
		});
	}
	return clients;
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

function commitWsUpgrade(res, context, userKey, headers, address) {
	const sessionId = crypto.randomUUID();
	const connectedAt = Date.now();
	res.upgrade(
		{
			sessionId,
			userKey,
			address,
			connectedAt,
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
	.get("/online", (res, req) => {
		if (!assertGetAuthorized(req, res)) return;
		let aborted = false;
		res.onAborted(() => {
			aborted = true;
		});
		const { tenant, service_id } = redisPresence.scope();
		if (!redisPresence.ready()) {
			jsonHttp(res, {
				source: "local",
				tenant,
				service_id,
				connections: connectionCount(),
				unique_users: uniqueLocalCount(),
				clients: peerList(),
				redis: redisPresence.redisState(),
			});
			return;
		}
		Promise.all([
			redisPresence.listOnline(),
			redisPresence.countOnline(),
			redisPresence.countUniqueUsers(),
		])
			.then(([clients, n, uq]) => {
				if (aborted) return;
				jsonHttp(res, {
					source: "redis",
					tenant,
					service_id,
					connections: n ?? clients.length,
					unique_users: uq ?? 0,
					clients,
					redis: redisPresence.redisState(),
				});
			})
			.catch(() => {
				if (aborted) return;
				jsonHttp(res, { status: "error" }, "500 Internal Server Error");
			});
	})
	.post("/admin/kick", (res, req) => {
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
	})
	.post("/admin/kick-all", (res, req) => {
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
	})
	.ws("/*", {
		compression: uWS.SHARED_COMPRESSOR,
		maxPayloadLength: 64 * 1024,
		idleTimeout: 120,
		upgrade: (res, req, context) => {
			const headers = copyWsUpgradeHeaders(req);
			const address = remoteAddressText(req);

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
				commitWsUpgrade(res, context, userKey, headers, address);
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

			clientsById.set(sessionId, {
				ws,
				connectedAt,
				address,
				userKey,
			});

			console.log(
				"CONNECT",
				address,
				sessionId,
				userKey,
				"total",
				connectionCount(),
			);

			redisPresence
				.recordConnect(sessionId, {
					connectedAt,
					address,
					user_id: userKey,
				})
				.catch((e) => console.error("redis recordConnect", e.message));

			sendWsJson(ws, {
				event: "welcome",
				message: "presence-ws",
				session_id: sessionId,
				clientId: sessionId,
				user_id: userKey,
			});

			broadcastExcept(ws, {
				event: "join",
				session_id: sessionId,
				clientId: sessionId,
				user_id: userKey,
			});
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
			clientsById.delete(sid);
			redisPresence
				.recordDisconnect(sid)
				.catch((e) => console.error("redis recordDisconnect", e.message));
			broadcastExcept(ws, {
				event: "leave",
				session_id: sid,
				clientId: sid,
				user_id: uk,
			});
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
		res.end();
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
