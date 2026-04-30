frappe.pages['socket-monitor'].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Socket Monitor',
		single_column: true
	});

	const container = $(`
    <div style="padding:15px">
        <h2>Connections: <span id="count">0</span></h2>
        <div id="log" style="height:300px; overflow:auto; background:#111; color:#0f0; padding:10px; font-family:monospace;"></div>
    </div>
`);

	$(page.body).append(container);

	function log(msg) {
		const el = document.getElementById("log");
		const time = new Date().toLocaleTimeString();
		el.innerHTML += `<div>${time} | ${msg}</div>`;
		el.scrollTop = el.scrollHeight;
	}

	frappe.realtime.on("connections_update", (data) => {
		document.getElementById("count").innerText = data.count;
		log(`${data.event} user=${data.user}`);
	});

	frappe.realtime.socket.onAny((event, ...args) => {
		log(`RAW ${event} ${JSON.stringify(args)}`);
	});
};
