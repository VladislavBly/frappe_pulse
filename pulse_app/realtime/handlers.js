/**
 * Pulse: Socket.IO → Redis (счётчики вкладок) + публикация в канал ``events``
 * (тот же путь, что ``frappe.publish_realtime`` → Node → Socket.IO).
 * Список «кто онлайн» в приложении строится только по этим счётчикам.
 */

const path = require("path");

const frappe_node_utils = path.resolve(__dirname, "..", "..", "frappe", "node_utils");
const { get_redis_subscriber } = require(frappe_node_utils);

let _redis_cache = null;
let _redis_queue_pub = null;

async function redis_cache() {
	if (!_redis_cache) {
		_redis_cache = get_redis_subscriber("redis_cache");
		if (!_redis_cache.isOpen) {
			await _redis_cache.connect();
		}
	}
	return _redis_cache;
}

/** Отдельное соединение: процесс realtime уже занят subscribe на ``events``. */
async function redis_queue_publish_client() {
	if (!_redis_queue_pub) {
		_redis_queue_pub = get_redis_subscriber("redis_queue");
		if (!_redis_queue_pub.isOpen) {
			await _redis_queue_pub.connect();
		}
	}
	return _redis_queue_pub;
}

function site_name(socket) {
	const n = socket.nsp && socket.nsp.name;
	if (!n || n.length < 2) {
		return null;
	}
	return n.slice(1);
}

function ref_key(site) {
	return `pulse_app:socket_ref:${site}`;
}

function rev_key(site) {
	return `pulse_app:presence_rev:${site}`;
}

async function publish_pulse_presence_via_redis(site, message) {
	const client = await redis_queue_publish_client();
	const payload = JSON.stringify({
		event: "pulse_presence",
		message,
		room: "all",
		namespace: site,
	});
	await client.publish("events", payload);
}

module.exports = function pulse_app_realtime_handlers(socket) {
	const site = site_name(socket);
	const user = socket.user;
	if (!site || !user || user === "Guest") {
		return;
	}
	if (socket.user_type !== "System User") {
		return;
	}

	const key = ref_key(site);
	const rk = rev_key(site);

	redis_cache()
		.then(async (r) => {
			const prevRaw = await r.hGet(key, user);
			const prevN = prevRaw != null ? parseInt(prevRaw, 10) : 0;
			const prevConnected = !Number.isNaN(prevN) && prevN > 0;
			await r.hIncrBy(key, user, 1);
			if (!prevConnected) {
				const rev = await r.incr(rk);
				await publish_pulse_presence_via_redis(site, {
					kind: "presence_update",
					user,
					service: "desk-socket",
					rev,
				});
			}
		})
		.catch((err) => console.warn("[pulse_app] socket connect:", err.message));

	socket.on("disconnect", () => {
		redis_cache()
			.then(async (r) => {
				const v = await r.hIncrBy(key, user, -1);
				const n = typeof v === "number" ? v : parseInt(v, 10);
				if (!Number.isNaN(n) && n <= 0) {
					await r.hDel(key, user);
					const rev = await r.incr(rk);
					await publish_pulse_presence_via_redis(site, {
						kind: "offline",
						user,
						rev,
					});
				}
			})
			.catch((err) => console.warn("[pulse_app] socket disconnect:", err.message));
	});
};
