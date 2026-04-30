app_name = "pulse_app"
app_title = "Pulse"
app_publisher = "Pulse"
app_description = "Pulse Frappe app — Desk workspace shell and folder layout."
app_email = "pulse@example.com"
app_license = "mit"

add_to_apps_screen = [
	{
		"name": "pulse_app",
		"title": "Pulse",
		"route": "/app/pulse",
		"logo": "/assets/pulse_app/images/pulse.svg",
	}
]

after_install = "pulse_app.pulse.install.after_install"
after_migrate = "pulse_app.pulse.install.after_migrate"
