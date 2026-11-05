"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os
from tempfile import mkdtemp

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"

c.ServerApp.port = int(os.environ.get("JUPYTER_TEST_PORT") or "8888")
c.LabApp.user_settings_dir = mkdtemp(prefix="galata-settings-")

# The workstation's message-of-the-day tab opens on the first load of every fresh
# browser context and becomes the active tab. Galata's readiness wait requires the
# Launcher to be active, so the suite times out before any test runs. The tab belongs
# to the lab, not to this extension, and no other test asserts it. Inert where the
# extension is not installed, as on CI.
c.GalaxaHubMotd.open_on_start = False
