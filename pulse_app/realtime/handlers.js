let connections = 0;

module.exports = function (socket) {
	const user = socket.user || "Guest";

	connections++;

	socket.nsp.emit("connections_update", {
		count: connections,
		user: user,
		event: "connect",
	});

	console.log("CONNECT", user, "TOTAL", connections);

	socket.on("disconnect", () => {
		connections = Math.max(0, connections - 1);

		socket.nsp.emit("connections_update", {
			count: connections,
			user: user,
			event: "disconnect",
		});

		console.log("DISCONNECT", user, "TOTAL", connections);
	});
};
