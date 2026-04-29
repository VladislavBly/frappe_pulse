app_name = "pulse_app"
app_title = "Pulse"
app_publisher = "Pulse"
app_description = "User presence, last activity, and login/session history for Frappe."
app_email = "pulse@example.com"
app_license = "mit"

# Плитка на экране приложений Desk (v15+): нужен ключ logo — иначе ошибка при create_desktop_icons_from_installed_apps).
# route ведёт на публичный Workspace Pulse (pulse/workspace/pulse/pulse.json).
add_to_apps_screen = [
	{
		"name": "pulse_app",
		"title": "Pulse",
		"route": "/app/pulse",
		"logo": "",
	}
]

# After install / migrate
# ------------
after_install = "pulse_app.pulse.install.after_install"
after_migrate = "pulse_app.pulse.install.after_migrate"

# Request routing (custom REST under /api/pulse/*)
# ------------
before_request = ["pulse_app.utils.api_routes.handle_api_routes"]

# Desk: подключение Socket.IO → pulse_socket.js → pulse_app.api.presence.mark_online → publish_realtime
# ------------
app_include_js = "/assets/pulse_app/js/pulse_socket.js"

# User list: колонка Pulse + Online/Away — через doctype_list_js (на списке надёжнее, чем только doctype_js)
# ------------
doctype_list_js = {"User": "public/js/user_pulse.js"}
