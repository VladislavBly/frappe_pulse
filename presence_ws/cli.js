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

function httpGetJson(urlStr) {
	return new Promise((resolve, reject) => {
		const req = http.get(urlStr, (res) => {
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => {
				try {
					resolve(JSON.parse(body));
				} catch {
					resolve({ raw: body, status: res.statusCode });
				}
			});
		});
		req.on("error", reject);
		req.setTimeout(8000, () => {
			req.destroy();
			reject(new Error("timeout"));
		});
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
  health        — HTTP GET /health  →  [HTTP /health]
  stat / stats  — то же, что health
  online        — HTTP GET /online (полный список из Redis)  →  [HTTP /online]
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
		const cmd = line.trim().toLowerCase();
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
