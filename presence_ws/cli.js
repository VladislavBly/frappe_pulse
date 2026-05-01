#!/usr/bin/env node
"use strict";

const http = require("http");
const readline = require("readline");
const { URL } = require("url");
const WebSocket = require("ws");

function defaultUrl() {
	return (
		process.env.WS_URL ||
		"ws://127.0.0.1:8765/?user_id=cli"
	);
}

function parseArgs(argv) {
	let url = defaultUrl();
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--url" && argv[i + 1]) {
			url = argv[++i];
		} else if (a.startsWith("ws://") || a.startsWith("wss://")) {
			url = a;
		}
	}
	return url;
}

function wsToHttpHealth(wsUrl) {
	const u = new URL(wsUrl);
	u.protocol = u.protocol === "wss:" ? "https:" : "http:";
	u.pathname = "/health";
	u.search = "";
	u.hash = "";
	return u.toString();
}

function wsToHttpOnline(wsUrl) {
	const u = new URL(wsUrl);
	u.protocol = u.protocol === "wss:" ? "https:" : "http:";
	u.pathname = "/online";
	u.search = "";
	u.hash = "";
	return u.toString();
}

function readXApiToken() {
	return (
		process.env.PRESENCE_X_API_TOKEN ||
		process.env.METRICS_AUTH_TOKEN ||
		""
	).trim();
}

function httpGetJson(urlStr) {
	const token = readXApiToken();
	const u = new URL(urlStr);
	const isHttps = u.protocol === "https:";
	const lib = isHttps ? require("https") : http;
	const headers = {};
	if (token) headers["X-Api-Token"] = token;

	return new Promise((resolve, reject) => {
		const req = lib.request(
			{
				hostname: u.hostname,
				port: u.port || (isHttps ? 443 : 80),
				path: `${u.pathname}${u.search}`,
				method: "GET",
				headers,
			},
			(res) => {
				let body = "";
				res.on("data", (c) => (body += c));
				res.on("end", () => {
					try {
						resolve(JSON.parse(body));
					} catch {
						resolve({ raw: body, status: res.statusCode });
					}
				});
			},
		);
		req.on("error", reject);
		req.setTimeout(8000, () => {
			req.destroy();
			reject(new Error("timeout"));
		});
		req.end();
	});
}

function printJson(label, raw) {
	const s = raw.toString();
	try {
		const j = JSON.parse(s);
		console.log(label, JSON.stringify(j, null, 2));
	} catch {
		console.log(label, s);
	}
}

function localHelp() {
	console.log(`
Разделение: WebSocket — только присутствие (welcome/join/leave), без счётчиков.
Счётчики и Redis — отдельно: HTTP или команды ниже (не в потоке WS).

По WebSocket ([←]): только welcome, join, leave и ответы на info/stats вручную.

Команды в > :
  help          — эта справка
  health        — HTTP GET /health (если задан PRESENCE_X_API_TOKEN — передаётся в заголовке)
  stat / stats  — то же, что health
  online        — HTTP GET /online (полный список из Redis)  →  [HTTP /online]
  kick <uuid>   — HTTP POST /admin/kick (нужен ADMIN_TOKEN в env)
  kickall       — HTTP POST /admin/kick-all
  url           — текущий WS URL
  reconnect     — новое WS-подключение
  quit          — выход (или Ctrl+C)

WS_URL='ws://127.0.0.1:8765/?user_id=cli' npm run cli
node cli.js --url 'ws://127.0.0.1:8765/?user_id=my-opaque-id'
`);
}

async function runOnline(wsUrl) {
	try {
		const h = wsToHttpOnline(wsUrl);
		const j = await httpGetJson(h);
		console.log("[HTTP /online]", JSON.stringify(j, null, 2));
	} catch (e) {
		console.error("[HTTP /online] ошибка:", e.message);
	}
}

async function runHealth(wsUrl) {
	try {
		const h = wsToHttpHealth(wsUrl);
		const j = await httpGetJson(h);
		console.log("[HTTP /health]", JSON.stringify(j, null, 2));
	} catch (e) {
		console.error("[HTTP /health] ошибка:", e.message);
	}
}

function httpOriginFromWsUrl(wsUrl) {
	const u = new URL(wsUrl);
	const proto = u.protocol === "wss:" ? "https:" : "http:";
	return `${proto}//${u.host}`;
}

function httpPostJson(urlStr, bodyObj, headers) {
	const body = JSON.stringify(bodyObj);
	const u = new URL(urlStr);
	const isHttps = u.protocol === "https:";
	const lib = isHttps ? require("https") : require("http");
	const opts = {
		hostname: u.hostname,
		port: u.port || (isHttps ? 443 : 80),
		path: `${u.pathname}${u.search}`,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(body),
			...headers,
		},
	};
	return new Promise((resolve, reject) => {
		const req = lib.request(opts, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode, body: JSON.parse(data) });
				} catch {
					resolve({ status: res.statusCode, raw: data });
				}
			});
		});
		req.on("error", reject);
		req.setTimeout(15000, () => {
			req.destroy();
			reject(new Error("timeout"));
		});
		req.write(body);
		req.end();
	});
}

async function runAdminKick(wsUrl, sessionId) {
	const token = (process.env.ADMIN_TOKEN || "").trim();
	if (!token) {
		console.error("Задайте ADMIN_TOKEN в окружении");
		return;
	}
	const url = `${httpOriginFromWsUrl(wsUrl)}/admin/kick`;
	try {
		const r = await httpPostJson(
			url,
			{ session_id: sessionId },
			{ "X-Admin-Token": token },
		);
		console.log("[HTTP /admin/kick]", JSON.stringify(r, null, 2));
	} catch (e) {
		console.error("[HTTP /admin/kick] ошибка:", e.message);
	}
}

async function runAdminKickAll(wsUrl) {
	const token = (process.env.ADMIN_TOKEN || "").trim();
	if (!token) {
		console.error("Задайте ADMIN_TOKEN в окружении");
		return;
	}
	const url = `${httpOriginFromWsUrl(wsUrl)}/admin/kick-all`;
	try {
		const r = await httpPostJson(url, {}, { "X-Admin-Token": token });
		console.log("[HTTP /admin/kick-all]", JSON.stringify(r, null, 2));
	} catch (e) {
		console.error("[HTTP /admin/kick-all] ошибка:", e.message);
	}
}

function main() {
	const wsUrl = parseArgs(process.argv);
	console.log("presence-ws CLI  WS=", wsUrl);
	localHelp();

	let ws = null;
	let rl = null;

	function attachWsHandlers(socket) {
		socket.on("open", () => {
			console.log("[WS] подключено");
		});

		socket.on("message", (data) => printJson("[←]", data));

		socket.on("close", () => console.log("[WS] соединение закрыто"));

		socket.on("error", (err) => console.error("[WS] ошибка:", err.message));
	}

	function connect() {
		ws = new WebSocket(wsUrl);
		attachWsHandlers(ws);
		return ws;
	}

	connect();

	function shutdown() {
		try {
			ws.close();
		} catch {
			/* */
		}
		if (rl) rl.close();
		process.exit(0);
	}
	process.on("SIGINT", shutdown);

	rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	rl.setPrompt("> ");
	rl.prompt();

	rl.on("line", async (line) => {
		const raw = line.trim();
		const low = raw.toLowerCase();
		if (low === "kickall" || low === "kick-all") {
			await runAdminKickAll(wsUrl);
			rl.prompt();
			return;
		}
		if (low.startsWith("kick ")) {
			const sid = raw.slice(5).trim();
			if (sid) await runAdminKick(wsUrl, sid);
			else console.log("usage: kick <session_id>");
			rl.prompt();
			return;
		}
		const cmd = low;
		switch (cmd) {
			case "":
				break;
			case "quit":
			case "exit":
			case "q":
				shutdown();
				break;
			case "help":
			case "?":
				localHelp();
				break;
			case "health":
			case "stat":
			case "stats":
				await runHealth(wsUrl);
				break;
			case "online":
			case "o":
				await runOnline(wsUrl);
				break;
			case "url":
				console.log(wsUrl);
				break;
			case "reconnect":
				try {
					ws.close();
				} catch {
					/* */
				}
				connect();
				break;
			default:
				console.log("неизвестная команда, введите help");
		}
		rl.prompt();
	});
}

main();
