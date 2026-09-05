"""`ProviderRuntime` — the resolved-input value object every adapter
constructor accepts (LLD §7.3). Lives in `ports` (not `registry`) so
`adapters/**` can import it without adapters depending on `registry`
(`.importlinter`'s `layers` contract enforces `registry -> adapters`, never
the reverse).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Timeouts:
    """Adapter request/connect timeouts, resolved once (LLD §7.3)."""

    request_ms: int = 15000
    connect_ms: int = 5000


@dataclass(frozen=True)
class ProviderRuntime:
    """Everything an adapter needs, resolved: no adapter reads env or the
    config directly (LLD §7.3).
    """

    logical_key: str
    endpoint_url: str | None
    api_key: str | None
    model: str | None
    extra: Mapping[str, Any] = field(default_factory=dict)
    timeouts: Timeouts = field(default_factory=Timeouts)
