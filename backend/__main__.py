"""Start the backend on the first free port, from 8000 up.

    .venv/bin/python -m backend          (Mac)
    .venv\\Scripts\\python -m backend      (Windows)

If 8000 is taken (another app, or an old Tended that didn't stop), it tries
8001, 8002 and so on, prints the port it picked, and writes it to
data/backend.port. The frontend's dev server reads that file on every
request, so it finds the backend wherever it is. TENDED_PORT sets the
first port to try. One process, no auto-reloader.
"""

import atexit
import os
import socket

import uvicorn

from backend.config import DATA_DIR
from backend.main import app

PORT_FILE = DATA_DIR / "backend.port"
TRIES = 20


def free_port(start: int) -> int:
    for port in range(start, start + TRIES):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                print(f"Port {port} is in use, trying {port + 1}…", flush=True)
                continue
            return port
    raise SystemExit(f"No free port between {start} and {start + TRIES - 1}. See Troubleshooting in the README.")


def main() -> None:
    port = free_port(int(os.getenv("TENDED_PORT", "8000")))
    PORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    PORT_FILE.write_text(str(port), encoding="utf-8")
    atexit.register(lambda: PORT_FILE.unlink(missing_ok=True))
    print(f"Tended backend: http://localhost:{port}  (the frontend finds it automatically)", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
