"""The ``shj3-ai`` FastAPI application object.

Scope of this module — read before adding to it
--------------------------------------------------
This is deliberately small: it constructs the ``FastAPI`` app, mounts the
routers that exist today, and wires the observability story (architecture.md
§10, deployment.md §13.1). It is **not** ``shj3_ai.entrypoint``, the module
deployment.md §5.3's Dockerfile ``ENTRYPOINT`` names and that dispatches on
``SHJ3_AI_ROLE`` (#20) between the ``api`` and ``worker`` workloads — that
module does not exist yet, and building it means boot-time config validation
(deployment.md §4.1 rule 2, a Pydantic ``Settings`` model) and role dispatch
that are out of scope here. When it is built, it should import :data:`app`
from this module rather than constructing a second ``FastAPI`` instance.

Why tracing is configured at import time
-------------------------------------------
``configure_tracing()`` and ``instrument_fastapi_app()`` both no-op safely on
a second call (see ``observability/tracing.py``), so calling them here at
module load — rather than only from a future ``entrypoint.py`` — means every
test that imports this module (:class:`fastapi.testclient.TestClient`
included) gets a real, instrumented app, not one that only traces correctly
in production.

B-5's readiness wiring
-----------------------
``runtime_state.py``'s own doc comment named this module's gap plainly: no
model-client construction existed anywhere, so ``/readyz`` could never
honestly report ready. ``chat_model_from_environment()`` (B-5) is the first
real model-client construction path — it always succeeds cheaply and without
network I/O (a plain OpenRouter API-key wrapper, or the dependency-free
deterministic fallback when no key is configured; see that factory's own
docstring), so calling it once at import time and marking the process ready
is honest: it reflects "this process has a real, working ``ChatModel``
implementation to hand every request", not a live-verified handshake with
OpenRouter (`entrypoint.py`'s future boot sequence is still the right place
for that, should this pass need one later).
"""

from __future__ import annotations

from fastapi import FastAPI

from shj3_ai.adapters.inbound.agent_authoring_router import router as agent_authoring_router
from shj3_ai.adapters.inbound.conversation_router import router as conversation_router
from shj3_ai.adapters.inbound.evaluation_router import router as evaluation_router
from shj3_ai.adapters.inbound.flow_authoring_router import router as flow_authoring_router
from shj3_ai.adapters.inbound.health_router import router as health_router
from shj3_ai.adapters.inbound.knowledge_router import router as knowledge_router
from shj3_ai.adapters.inbound.orchestration_preview_router import (
    router as orchestration_preview_router,
)
from shj3_ai.adapters.inbound.provisioning_router import router as provisioning_router
from shj3_ai.adapters.inbound.sandbox_router import router as sandbox_router
from shj3_ai.adapters.inbound.tools_router import router as tools_router
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import chat_model_from_environment
from shj3_ai.observability.tracing import configure_tracing, instrument_fastapi_app
from shj3_ai.runtime_state import mark_model_clients_ready

configure_tracing()

app = FastAPI(title="shj3-ai")
app.include_router(agent_authoring_router)
app.include_router(health_router)
app.include_router(provisioning_router)
app.include_router(knowledge_router)
app.include_router(conversation_router)
app.include_router(evaluation_router)
app.include_router(tools_router)
app.include_router(flow_authoring_router)
app.include_router(sandbox_router)
app.include_router(orchestration_preview_router)
instrument_fastapi_app(app)

chat_model_from_environment()  # constructs cleanly either way; see doc comment above
mark_model_clients_ready()
