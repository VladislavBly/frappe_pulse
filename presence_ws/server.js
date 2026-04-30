"use strict";

const crypto = require("crypto");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const redisPresence = require("./redis-presence");

const PORT = Number.parseInt(process.env.PORT || "8765", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const startedAt = Date.now();

/** @type {Map<string, { ws: import('ws'), connectedAt: number, address: string, userKey: string }>} */
const clientsById = new Map();

function connectionCount() {
	return clientsById.size;
}

/** Сколько разных user_id среди локальных сокетов (без Redis). */
function uniqueLocalCount() {
	const keys = new Set();
	for (const meta of clientsById.values()) {
		keys.add(meta.userKey);
	}
	return keys.size;
}

/** Обязателен query `user_id` или `sub` (непустая строка). Иначе соединение закрывается. */
function parseRequiredUserId(req) {
	try {
		const u = new URL(req.url || "/", "http://localhost");
		const raw = u.searchParams.get("user_id") || u.searchParams.get("sub");
		if (raw && raw.trim()) return raw.trim().slice(0, 512);
	} catch {
		/* */
	}
	return null;
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
	const redis = redisPresence.redisState();
	const local = connectionCount();
	const base = {
		status: "ok",
		service: "presence-ws",
		connections: local,
		tenant,
		service_id,
		redis,
		connections_local: local,
	};
	return base;
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

const server = http.createServer(async (req, res) => {
	if (req.url === "/health" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(await healthPayloadAsync()));
		return;
	}
	if (req.url === "/online" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		const { tenant, service_id } = redisPresence.scope();
		if (!redisPresence.ready()) {
			res.end(
				JSON.stringify({
					source: "local",
					tenant,
					service_id,
					connections: connectionCount(),
					unique_users: uniqueLocalCount(),
					clients: peerList(),
					redis: redisPresence.redisState(),
				}),
			);
			return;
		}
		const clients = await redisPresence.listOnline();
		const n = await redisPresence.countOnline();
		const uq = await redisPresence.countUniqueUsers();
		res.end(
			JSON.stringify({
				source: "redis",
				tenant,
				service_id,
				connections: n ?? clients.length,
				unique_users: uq ?? 0,
				clients,
				redis: redisPresence.redisState(),
			}),
		);
		return;
	}
	res.writeHead(404);
	res.end();
});

const wss = new WebSocketServer({ server });

function broadcastExcept(payload, exceptWs) {
	const data = JSON.stringify(payload);
	for (const client of wss.clients) {
		if (client === exceptWs) continue;
		if (client.readyState === WebSocket.OPEN) {
			client.send(data);
		}
	}
}

function sendError(ws, message) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ event: "error", message }));
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
		ws.send(
			JSON.stringify({
				event: "info",
				service: "presence-ws",
				alive: true,
				connections,
				unique_users,
				uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
				clients,
				redis: redisPresence.redisState(),
			}),
		);
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
		ws.send(
			JSON.stringify({
				event: "stats",
				alive: true,
				connections,
				unique_users,
				uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
				redis: redisPresence.redisState(),
			}),
		);
		return;
	}

	const isKick = cmd === "kick" || cmd === "kickall" || cmd === "kick_all";
	if (!isKick) {
		return;
	}

	if (!ADMIN_TOKEN) {
		sendError(ws, "kick disabled: set ADMIN_TOKEN on server");
		return;
	}

	const token = payload && (payload.token || payload.secret);
	if (token !== ADMIN_TOKEN) {
		sendError(ws, "forbidden");
		return;
	}

	const kickAll =
		cmd === "kickall" ||
		cmd === "kick_all" ||
		(payload && (payload.all === true || payload.all === "all"));

	if (kickAll) {
		for (const meta of Array.from(clientsById.values())) {
			try {
				if (meta.ws.readyState === WebSocket.OPEN) {
					meta.ws.send(JSON.stringify({ event: "bye", reason: "kickAll" }));
					meta.ws.close();
				}
			} catch {
				/* */
			}
		}
		return;
	}

	const targetId =
		payload &&
		(payload.session_id ||
			payload.id ||
			payload.target ||
			payload.clientId);
	if (!targetId || typeof targetId !== "string") {
		sendError(ws, "kick: need session_id");
		return;
	}

	const meta = clientsById.get(targetId);
	if (!meta) {
		sendError(ws, "kick: client not found");
		return;
	}

	try {
		if (meta.ws.readyState === WebSocket.OPEN) {
			meta.ws.send(JSON.stringify({ event: "bye", reason: "kick" }));
			meta.ws.close();
		}
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(
				JSON.stringify({
					event: "kicked",
					session_id: targetId,
					id: targetId,
					clientId: targetId,
				}),
			);
		}
	} catch {
		sendError(ws, "kick failed");
	}
}

function onClientMessage(ws, text) {
	const trimmed = text.trim();
	if (!trimmed) return;

	if (/^info$/i.test(trimmed)) {
		handleCommand(ws, "info", {});
		return;
	}
	if (/^stats$/i.test(trimmed)) {
		handleCommand(ws, "stats", {});
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
		handleCommand(ws, payload.action, payload);
		return;
	}
	handleCommand(ws, cmd, payload);
}

wss.on("connection", (ws, req) => {
	const address = `${req.socket.remoteAddress || "?"}`;
	const userKey = parseRequiredUserId(req);
	if (!userKey) {
		console.log("REJECT", address, "missing user_id or sub");
		ws.close(1008, "user_id or sub query parameter required");
		return;
	}

	const sessionId = crypto.randomUUID();
	const connectedAt = Date.now();
	clientsById.set(sessionId, { ws, connectedAt, address, userKey });
	ws.sessionId = sessionId;

	console.log("CONNECT", address, sessionId, userKey, "total", connectionCount());

	redisPresence
		.recordConnect(sessionId, {
			connectedAt,
			address,
			user_id: userKey,
		})
		.catch((e) => console.error("redis recordConnect", e.message));

	/* Сессия = уникальный UUID на каждое подключение; user_id — opaque пользователя */
	ws.send(
		JSON.stringify({
			event: "welcome",
			message: "presence-ws",
			session_id: sessionId,
			clientId: sessionId,
			user_id: userKey,
		}),
	);

	broadcastExcept(
		{ event: "join", session_id: sessionId, clientId: sessionId, user_id: userKey },
		ws,
	);

	ws.on("message", (data, isBinary) => {
		if (isBinary) return;
		onClientMessage(ws, data.toString());
	});

	ws.on("close", () => {
		const sid = ws.sessionId;
		const meta = clientsById.get(sid);
		const uk = meta?.userKey ?? `anon:${sid}`;
		clientsById.delete(sid);
		redisPresence.recordDisconnect(sid).catch((e) => console.error("redis recordDisconnect", e.message));
		broadcastExcept(
			{ event: "leave", session_id: sid, clientId: sid, user_id: uk },
			ws,
		);
		console.log("DISCONNECT", address, sid, uk, "total", connectionCount());
	});

	ws.on("error", (err) => {
		console.error("ws error", address, err.message);
	});
});

function shutdown(signal) {
	console.log(signal, "shutting down");
	wss.close(() => {
		redisPresence.quit().finally(() => {
			server.close(() => process.exit(0));
		});
	});
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
	server.listen(PORT, HOST, () => {
		const rs = redisPresence.redisState();
		console.log(
			`presence-ws http+ws http://${HOST}:${PORT} health=/health online=/online redis=${rs} kick=${ADMIN_TOKEN ? "on" : "off"}`,
		);
	});
})();
