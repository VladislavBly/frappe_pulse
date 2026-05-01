"use strict";

const FRAPPE_VERIFY_URL = (process.env.FRAPPE_PRESENCE_VERIFY_URL || "").trim();
const FRAPPE_VERIFY_SECRET = (process.env.FRAPPE_PRESENCE_VERIFY_SECRET || "").trim();
const FRAPPE_VERIFY_TIMEOUT_MS = Number.parseInt(
	process.env.FRAPPE_PRESENCE_VERIFY_TIMEOUT_MS || "5000",
	10,
);

function isEnabled() {
	return Boolean(FRAPPE_VERIFY_URL && FRAPPE_VERIFY_SECRET);
}

/** @param {string | undefined} cookieHeader */
function parseSidFromCookie(cookieHeader) {
	if (!cookieHeader) return "";
	const parts = String(cookieHeader).split(";");
	for (const p of parts) {
		const i = p.indexOf("=");
		if (i === -1) continue;
		const k = p.slice(0, i).trim();
		if (k !== "sid") continue;
		let v = p.slice(i + 1).trim();
		try {
			v = decodeURIComponent(v);
		} catch {
			/* */
		}
		return v.slice(0, 128);
	}
	return "";
}

/**
 * @param {{ sid?: string, ticket?: string }} cred
 * @returns {Promise<{ ok: true, userKey: string } | { ok: false, status: string, body: string }>}
 */
async function verifyUpgrade(cred) {
	const sid = (cred.sid || "").trim().slice(0, 128);
	const ticket = (cred.ticket || "").trim().slice(0, 200);
	if (!sid && !ticket) {
		return {
			ok: false,
			status: "401 Unauthorized",
			body: "ticket or sid required (Frappe verification is enabled)",
		};
	}

	const body = {};
	if (ticket) body.ticket = ticket;
	if (sid) body.sid = sid;

	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), FRAPPE_VERIFY_TIMEOUT_MS);
	try {
		const r = await fetch(FRAPPE_VERIFY_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Pulse-Presence-Secret": FRAPPE_VERIFY_SECRET,
			},
			body: JSON.stringify(body),
			signal: ac.signal,
		});
		const text = await r.text();
		let parsed = null;
		try {
			parsed = JSON.parse(text);
		} catch {
			/* */
		}
		if (!r.ok) {
			const line =
				{
					400: "400 Bad Request",
					401: "401 Unauthorized",
					403: "403 Forbidden",
					404: "404 Not Found",
					422: "422 Unprocessable Entity",
					500: "500 Internal Server Error",
					502: "502 Bad Gateway",
				}[r.status] || "403 Forbidden";
			return {
				ok: false,
				status: line,
				body: text.slice(0, 512) || "upstream rejected session",
			};
		}
		const userId = parsed && parsed.data && parsed.data.user_id;
		if (!userId || typeof userId !== "string") {
			return {
				ok: false,
				status: "502 Bad Gateway",
				body: "invalid Frappe verify response",
			};
		}
		const userKey = userId.trim().slice(0, 512);
		if (!userKey) {
			return {
				ok: false,
				status: "502 Bad Gateway",
				body: "empty user_id from Frappe",
			};
		}
		return { ok: true, userKey };
	} catch (e) {
		const name = e && typeof e === "object" && "name" in e ? e.name : "";
		if (name === "AbortError") {
			return {
				ok: false,
				status: "504 Gateway Timeout",
				body: "Frappe verify timeout",
			};
		}
		return {
			ok: false,
			status: "502 Bad Gateway",
			body: "Frappe verify request failed",
		};
	} finally {
		clearTimeout(t);
	}
}

module.exports = {
	isEnabled,
	parseSidFromCookie,
	verifyUpgrade,
	FRAPPE_VERIFY_TIMEOUT_MS,
};
