# Установка / обновление pulse_app на bench

```bash
sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && for d in sites/*/; do s=$(basename "$d"); test -f "sites/$s/site_config.json" || continue; echo "--- uninstall: $s ---"; /home/frappe/.local/bin/bench --site "$s" uninstall-app pulse_app --yes || true; done'

sudo rm -rf /home/frappe/frappe-bench/apps/frappe_pulse /home/frappe/frappe-bench/apps/pulse_app

sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && /home/frappe/.local/bin/bench get-app https://github.com/VladislavBly/frappe_pulse.git --branch main --overwrite --skip-assets'

sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && for d in sites/*/; do s=$(basename "$d"); test -f "sites/$s/site_config.json" || continue; echo "--- install: $s ---"; /home/frappe/.local/bin/bench --site "$s" install-app pulse_app || true; done'

sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && /home/frappe/.local/bin/bench --site all migrate'
sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && /home/frappe/.local/bin/bench build --app pulse_app'
sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && /home/frappe/.local/bin/bench restart'
sudo -u frappe -H bash -lc 'cd /home/frappe/frappe-bench && /home/frappe/.local/bin/bench --site all clear-cache'

echo "Готово."
```
