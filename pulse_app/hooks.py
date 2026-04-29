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

# Request routing (custom REST under /api/pulse/*)
# ------------
before_request = ["pulse_app.utils.api_routes.handle_api_routes"]

# Desk: Socket.IO + глобально user_pulse.js (иначе другие приложения перезаписывают listview_settings User)
# ------------
app_include_js = [
	"/assets/pulse_app/js/pulse_socket.js",
	"/assets/pulse_app/js/user_pulse.js",
]

# Только app_include_js — двойная загрузка User doctype_js ломала отрисовку формы у части сайтов.
