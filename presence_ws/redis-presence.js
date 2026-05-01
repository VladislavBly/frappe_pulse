"use strict";

const crypto = require("crypto");
const { createClient } = require("redis");

const TENANT = process.env.PRESENCE_TENANT || "default";
const SERVICE_ID = process.env.PRESENCE_SERVICE_ID || "presence-ws";
const NODE_TAG =
	process.env.NODE_INSTANCE_ID ||
	process.env.HOSTNAME ||
	"node";

function sha256Hex(s) {
	return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** Hash tag for Redis Cluster — один slot */
function tag() {
	return `${TENANT}:${SERVICE_ID}`;
}

function sessionsKey() {
	return `presence:{${tag()}}:sessions`;
}

function refKey() {
	return `presence:{${tag()}}:ref`;
}

function uniqKey() {
	return `presence:{${tag()}}:uniq`;
}

let client;
let state = "off";

/**
 * @returns {Promise<any | null>}
 */
async function connect() {
	const url = process.env.REDIS_URL;
	if (!url) {
		state = "off";
		return null;
	}

	client = createClient({ url });
	client.on("error", (err) => {
		console.error("redis error", err.message);
	});

	try {
		await client.connect();
		state = "ok";
		console.log("redis connected", url.replace(/:[^:@/]+@/, ":****@"));
		return client;
	} catch (e) {
		console.error("redis connect failed", e.message);
		state = "error";
		client = undefined;
		if (process.env.REDIS_REQUIRED === "1" || process.env.REDIS_REQUIRED === "true") {
			throw e;
		}
		return null;
	}
}

function ready() {
	return state === "ok" && client?.isOpen;
}

async function recordConnect(sessionId, meta) {
	if (!ready()) return;
	const userKey =
		(meta && (meta.user_id || meta.userKey)) || `anon:${sessionId}`;
	const payload = {
		session_id: sessionId,
		...meta,
		user_id: userKey,
		node: NODE_TAG,
		tenant: TENANT,
		service: SERVICE_ID,
	};
	const digest = sha256Hex(userKey);
	const rkey = refKey();
	const n = await client.hIncrBy(rkey, digest, 1);
	if (n === 1) {
		await client.sAdd(uniqKey(), userKey);
	}
	await client.hSet(sessionsKey(), sessionId, JSON.stringify(payload));
}

async function recordDisconnect(sessionId) {
	if (!ready()) return;
	const raw = await client.hGet(sessionsKey(), sessionId);
	await client.hDel(sessionsKey(), sessionId);
	if (!raw) return;
	let userKey;
	try {
		userKey = JSON.parse(raw).user_id;
	} catch {
		return;
	}
	if (!userKey) userKey = `anon:${sessionId}`;
	const digest = sha256Hex(userKey);
	const rkey = refKey();
	const n = await client.hIncrBy(rkey, digest, -1);
	if (n <= 0) {
		await client.hDel(rkey, digest);
		await client.sRem(uniqKey(), userKey);
	}
}

async function countOnline() {
	if (!ready()) return null;
	return client.hLen(sessionsKey());
}

async function countUniqueUsers() {
	if (!ready()) return null;
	return client.sCard(uniqKey());
}

/**
 * @returns {Promise<{ id: string, session_id: string, connectedAt: number, address: string, node?: string, user_id: string, client_service?: string }[]>}
 */
async function listOnline() {
	if (!ready()) return [];
	const raw = await client.hGetAll(sessionsKey());
	const out = [];
	for (const [id, json] of Object.entries(raw)) {
		try {
			const o = JSON.parse(json);
			const row = {
				id,
				session_id: id,
				connectedAt: o.connectedAt,
				address: o.address,
				node: o.node,
				user_id: o.user_id || `anon:${id}`,
			};
			if (o.client_service) row.client_service = o.client_service;
			out.push(row);
		} catch {
			out.push({
				id,
				session_id: id,
				connectedAt: 0,
				address: "?",
				user_id: `anon:${id}`,
			});
		}
	}
	return out;
}

async function quit() {
	if (client?.isOpen) {
		await client.quit().catch(() => {});
	}
	state = "off";
}

function redisState() {
	return state;
}

function scope() {
	return { tenant: TENANT, service_id: SERVICE_ID };
}

module.exports = {
	connect,
	ready,
	recordConnect,
	recordDisconnect,
	countOnline,
	countUniqueUsers,
	listOnline,
	quit,
	redisState,
	scope,
	sessionsKey,
};
