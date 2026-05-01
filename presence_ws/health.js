#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

function readXApiToken() {
	return (
		process.env.PRESENCE_X_API_TOKEN ||
		process.env.METRICS_AUTH_TOKEN ||
		""
	).trim();
}

function targetUrl() {
	if (process.env.HEALTH_URL) return process.env.HEALTH_URL;
	const port = process.env.PORT || "8765";
	return `http://127.0.0.1:${port}/health`;
}

function getJson(urlStr) {
	const token = readXApiToken();
	const u = new URL(urlStr);
	const isHttps = u.protocol === "https:";
	const lib = isHttps ? https : http;
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
					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						reject(new Error(`HTTP ${res.statusCode}: ${body || res.statusMessage}`));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (e) {
						reject(new Error(`not JSON: ${body}`));
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

const url = (() => {
	const arg = process.argv[2];
	if (arg && (arg.startsWith("http://") || arg.startsWith("https://"))) {
		return new URL(arg).toString();
	}
	return targetUrl();
})();

getJson(url)
	.then((j) => {
		console.log(JSON.stringify(j, null, 2));
		process.exit(0);
	})
	.catch((e) => {
		console.error(e.message);
		process.exit(1);
	});
