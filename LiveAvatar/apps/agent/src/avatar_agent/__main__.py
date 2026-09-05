"""`python -m avatar_agent` entry point."""

from __future__ import annotations

from avatar_agent.telemetry.logging import configure_logging
from avatar_agent.worker import run

if __name__ == "__main__":
    configure_logging()
    run()
