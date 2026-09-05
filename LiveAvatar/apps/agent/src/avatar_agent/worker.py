"""LiveKit Agents worker bootstrap (LLD §3.3) — `WorkerOptions`, agent
name, and the CLI runner. `agent_name="avatar-agent"` matches the control
plane's `AGENT_NAME` env var (LLD §7.4) so explicit dispatch
(`AgentDispatchService.createDispatch`, LLD §8.3 step 7) reaches this worker.
"""

from __future__ import annotations

from livekit.agents import WorkerOptions, cli

from avatar_agent.entrypoint import handle_job
from avatar_agent.settings import load_settings


def build_worker_options() -> WorkerOptions:
    """Builds the `WorkerOptions` this process registers with LiveKit."""
    settings = load_settings()
    return WorkerOptions(
        entrypoint_fnc=handle_job,
        agent_name=settings.agent_name,
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )


def run() -> None:
    """Runs the LiveKit Agents CLI (`python -m avatar_agent`)."""
    cli.run_app(build_worker_options())
