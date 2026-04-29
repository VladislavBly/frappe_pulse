app_name = "pulse_app"
app_title = "Pulse"
app_publisher = "Pulse"
app_description = "User presence, last activity, and login/session history for Frappe."
app_email = "pulse@example.com"
app_license = "mit"

# Плитка на экране приложений Desk (v15+): задайте logo (файл в public/), иначе плитка может не создаться корректно.
# route ведёт на публичный Workspace Pulse (pulse/workspace/pulse/pulse.json).
add_to_apps_screen = [
	{
		"name": "pulse_app",
		"title": "Pulse",
		"route": "/app/pulse",
		"logo": "/assets/pulse_app/images/pulse.svg",
	}
]

# After install / migrate
# ------------
after_install = "pulse_app.pulse.install.after_install"
after_migrate = "pulse_app.pulse.install.after_migrate"

# Журнал Pulse Session Event + присутствие при входе/выходе (раньше не было подключено).
on_login = "pulse_app.pulse.auth_hooks.on_login"
on_logout = "pulse_app.pulse.auth_hooks.on_logout"

# Request routing (custom REST under /api/pulse/*)
# ------------
before_request = ["pulse_app.utils.api_routes.handle_api_routes"]

# Desk: только heartbeat mark_online / realtime (без подстановок в список User — см. страницу pulse-online).
# ------------
app_include_js = [
	"/assets/pulse_app/js/pulse_socket.js",
]

# Страница «Pulse — онлайн» (список онлайн + Ping): скрипт и стили только на этой странице.
page_js = {"pulse-online": "public/js/pulse_online_page.js"}
page_css = {"pulse-online": "public/css/pulse_online_page.css"}
