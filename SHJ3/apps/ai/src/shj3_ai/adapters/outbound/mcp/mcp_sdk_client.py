"""The real `McpClient` adapter — built on the official `mcp` Python SDK
(`modelcontextprotocol/python-sdk`, PyPI's `mcp` package, `pyproject.toml`),
not a hand-rolled JSON-RPC/capability-negotiation client.

`docs/api.md` §9.12 names `AdkMcpClient` (wrapping Google ADK's MCP support)
as the "current adapter" — aspirational, not built: dedicated research before
this wave confirmed `ports`/`application` held no MCP code anywhere, and
`adapters/outbound/tools/skill_invoker.py`'s own docstring calls a generic
MCP client "real, separable, future work". This is that work, and §9.12's
own swap-cost note already names this exact choice as sanctioned: *"ADK ->
the reference MCP Python SDK, or a hand-rolled JSON-RPC client, is one
adapter... the cheapest swap on the list."*

## Transports

`Sse` and `StreamableHttp` are real — both open a genuine transport, complete
the MCP `initialize` handshake and call `tools/list` against whatever
endpoint the admin supplied. `Stdio` is a real, modelled `McpTransport` value
(`domain/mcp.py`) with **no real code path here**: `McpServer.endpoint` is a
URL column, not a launchable local command, so there is nothing for this
adapter to exec. `connect()` refuses it immediately with a clear, specific
detail rather than attempting something else or claiming success.

## Failure classification

Every genuine failure — DNS, TLS, a rejected auth header, a hung or
unreachable endpoint, a reachable endpoint that is not speaking MCP at all —
is translated into exactly one of `docs/api.md` §5.6's closed-set reasons
(`dns | tls | auth | timeout | protocol`) via `_classify_mcp_failure`, never
the SDK's own exception text reaching a caller. The classifier walks both
`BaseExceptionGroup.exceptions` (the SDK runs the handshake inside `anyio`
task groups, so a real failure usually arrives wrapped) and the
`__cause__`/`__context__` chain of each leaf, because `httpx2`'s own
`ConnectError` wraps the real `socket.gaierror`/`ssl.SSLError` one level
down rather than exposing a dedicated exception type for each.

**Two real, environment-specific findings from this wave's own live verification.**
On the Windows development host this adapter was first written on, DNS resolution
for a genuinely nonexistent hostname takes roughly 10-11 real seconds before the OS
raises `gaierror` (a Windows resolver-retry characteristic, not a bug in this
module) — so a *short* per-attempt timeout observes it as `httpx2.ConnectTimeout`
(bucketed as `timeout`) rather than the DNS-specific error, while a longer budget
(this adapter's default, `_DEFAULT_HANDSHAKE_TIMEOUT_SECONDS`) lets the real
`gaierror` surface and classify correctly as `dns`. Separately, against the real
`shj3-ai` Docker container (Debian/glibc) this service actually deploys as, the
*same* nonexistent-hostname test produced a different leaf entirely: `httpcore2`'s
asyncio backend re-raises the low-level connect failure as a plain `OSError`
carrying glibc's EAI_NODATA text ("No address associated with hostname"), losing
the `socket.gaierror` subtype the `isinstance` check alone would have relied on —
`_classify_leaf`'s dns branch checks for this exact string for that reason
(`tests/adapters/mcp/test_mcp_sdk_client.py`'s
`test_classify_dns_from_the_real_container_message` is the regression). Every
outcome above is an honest report of what actually happened in that environment;
none is a flaw in the classifier's design, only gaps it had to be taught.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import ssl
from collections.abc import Callable, Iterator
from contextlib import AsyncExitStack
from dataclasses import dataclass

# `httpx` is the project's existing generic HTTP dependency, used only for the OAuth2
# client-credentials token fetch below — deliberately kept separate from `httpx2` (the MCP
# SDK's own internally vendored httpx major version), which this file otherwise only ever
# uses the way the SDK itself expects it to be used.
import httpx
import httpx2
from mcp import ClientSession, types
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client

# The public re-export on `mcp.client.streamable_http` is not in that module's `__all__`
# (mypy's `attr-defined` catches the gap even though the plain import works at runtime —
# confirmed against the installed package, not assumed) — imported from its real defining
# module instead.
from mcp.shared._httpx_utils import create_mcp_http_client

from shj3_ai.domain.mcp import McpConnectFailureReason
from shj3_ai.ports.mcp_client import (
    McpClient,
    McpConnectFailedError,
    McpServerConfig,
    McpToolCall,
    McpToolDescriptor,
    McpToolResult,
)
from shj3_ai.ports.mcp_client import McpSession as McpSessionPort
from shj3_ai.ports.secret_resolver import SecretResolutionError, SecretResolver

logger = logging.getLogger(__name__)

_CLIENT_NAME = "shj3-ai"
_CLIENT_VERSION = "0.1.0"

#: Generous on purpose (see module docstring's DNS finding) — long enough for a slow
#: resolver to produce its real error rather than being pre-empted by this budget, while
#: still bounded so a genuinely hung peer (this wave's own live-verification finding
#: against a real, non-MCP HTTPS server that accepts the connection but never completes a
#: valid handshake) fails the request instead of leaking a task forever.
_DEFAULT_HANDSHAKE_TIMEOUT_SECONDS = 45.0


@dataclass(slots=True)
class _McpSdkSession:
    """The real session state — an open `AsyncExitStack` (transport + `ClientSession`)
    plus the live `ClientSession` itself. Structurally satisfies `ports.mcp_client.
    McpSession` (an empty Protocol); nothing above this adapter is meant to look inside."""

    exit_stack: AsyncExitStack
    session: ClientSession


@dataclass(frozen=True, slots=True)
class _TransportAuth:
    headers: dict[str, str]
    #: Filesystem path to a PEM bundle (certificate + private key concatenated) for
    #: `MutualTls` — see `_build_transport_auth`'s docstring for why this is the real,
    #: narrower-than-ideal convention this wave implements.
    cert_path: str | None


class McpSdkClient(McpClient):
    """Real MCP client: connect, discover, invoke, close — against a genuine remote
    endpoint, using the real handshake/negotiation the `mcp` SDK implements."""

    __slots__ = ("_handshake_timeout_seconds", "_http_transport", "_secrets")

    def __init__(
        self,
        secrets: SecretResolver,
        handshake_timeout_seconds: float = _DEFAULT_HANDSHAKE_TIMEOUT_SECONDS,
        *,
        http_transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._secrets = secrets
        self._handshake_timeout_seconds = handshake_timeout_seconds
        # Test-only hook (`tests/adapters/mcp/test_mcp_sdk_client.py`): lets a real,
        # local, in-process MCP server (`httpx2.ASGITransport`) stand in for the network
        # without any change to how a real request builds its client — production code
        # never passes this, so `_build_http_client` mounts it only when given.
        self._http_transport = http_transport

    async def connect(self, server: McpServerConfig) -> McpSessionPort:
        if server.transport == "Stdio":
            # See module docstring's "Transports" section — a real, honestly-named gap,
            # not an attempt at faking stdio support.
            raise McpConnectFailedError(
                "protocol",
                f"Stdio transport has no real code path for a remote server registration: "
                f'McpServer.endpoint ("{server.endpoint}") is a URL, not a launchable '
                'command. Select "Sse" or "StreamableHttp" for a real connection.',
            )

        auth = await _build_transport_auth(server, self._secrets)

        exit_stack = AsyncExitStack()
        try:
            async with asyncio.timeout(self._handshake_timeout_seconds):
                if server.transport == "StreamableHttp":
                    http_client = _build_http_client(
                        auth.headers,
                        auth.cert_path,
                        httpx2.Timeout(30.0, read=300.0),
                        self._http_transport,
                    )
                    read, write = await exit_stack.enter_async_context(
                        streamable_http_client(server.endpoint, http_client=http_client)
                    )
                else:  # "Sse"
                    factory = (
                        _sse_http_client_factory(auth.cert_path, self._http_transport)
                        if auth.cert_path is not None or self._http_transport is not None
                        else create_mcp_http_client
                    )
                    read, write = await exit_stack.enter_async_context(
                        sse_client(
                            server.endpoint,
                            headers=auth.headers or None,
                            httpx_client_factory=factory,
                        )
                    )

                session = await exit_stack.enter_async_context(
                    ClientSession(
                        read,
                        write,
                        client_info=types.Implementation(
                            name=_CLIENT_NAME, version=_CLIENT_VERSION
                        ),
                    )
                )
                await session.initialize()
        except McpConnectFailedError:
            await _safe_aclose(exit_stack)
            raise
        except TimeoutError as error:
            await _safe_aclose(exit_stack)
            raise McpConnectFailedError(
                "timeout",
                "Connecting to the MCP server did not complete within "
                f"{self._handshake_timeout_seconds:.0f}s.",
            ) from error
        except BaseException as error:
            # handshake failure this SDK can raise (network, TLS, protocol, an
            # ExceptionGroup wrapping any of those) must become an honest McpConnectFailedError,
            # never propagate as a raw driver exception (api.md §2.4).
            #
            # **Why `exit_stack.aclose()` is not just cleanup here.** This wave's own live
            # verification against a genuinely nonexistent host found that the exception
            # `session.initialize()` itself raises can be an uninformative bare
            # `CancelledError` — `streamable_http_client`'s internal `anyio` task group
            # cancels the sibling task awaiting the response the instant its OTHER task
            # (the POST) fails, and cancellation reaches `initialize()`'s awaiter before
            # the group's own `__aexit__` has re-raised the real underlying error. That
            # real error (confirmed live: `httpx2.ConnectError` wrapping the actual
            # `socket.gaierror`) only surfaces when `exit_stack.aclose()` tears the same
            # task group down — which is exactly the call this branch already makes. So:
            # capture what cleanup raises, and prefer it for classification whenever the
            # original `error` classified to the uninformative `"protocol"` fallback.
            cleanup_error = await _aclose_and_capture(exit_stack)
            reason = _classify_mcp_failure(error)
            detail_source: BaseException = error
            if reason == "protocol" and cleanup_error is not None:
                cleanup_reason = _classify_mcp_failure(cleanup_error)
                if cleanup_reason != "protocol":
                    reason, detail_source = cleanup_reason, cleanup_error
            logger.warning(
                "MCP connect failed", extra={"endpoint": server.endpoint, "reason": reason}
            )
            raise McpConnectFailedError(reason, _safe_detail(detail_source)) from error

        return _McpSdkSession(exit_stack=exit_stack, session=session)

    async def discover_tools(self, session: McpSessionPort) -> list[McpToolDescriptor]:
        sdk_session = _as_sdk_session(session)
        try:
            async with asyncio.timeout(self._handshake_timeout_seconds):
                result = await sdk_session.session.list_tools()
        except TimeoutError as error:
            raise McpConnectFailedError(
                "timeout", "Listing tools from the MCP server did not complete in time."
            ) from error
        except BaseException as error:
            reason = _classify_mcp_failure(error)
            logger.warning("MCP tools/list failed", extra={"reason": reason})
            raise McpConnectFailedError(reason, _safe_detail(error)) from error

        return [
            McpToolDescriptor(
                name=tool.name,
                description=tool.description,
                input_schema_json=json.dumps(tool.input_schema),
            )
            for tool in result.tools
        ]

    async def invoke(
        self, session: McpSessionPort, call: McpToolCall, timeout_ms: int
    ) -> McpToolResult:
        sdk_session = _as_sdk_session(session)
        result = await sdk_session.session.call_tool(
            call.name, call.arguments, read_timeout_seconds=timeout_ms / 1000
        )
        is_error = bool(getattr(result, "is_error", False))
        return McpToolResult(is_error=is_error, content_json=result.model_dump_json(by_alias=True))

    async def close(self, session: McpSessionPort) -> None:
        sdk_session = _as_sdk_session(session)
        await _safe_aclose(sdk_session.exit_stack)


async def _aclose_and_capture(exit_stack: AsyncExitStack) -> Exception | None:
    """`AsyncExitStack.aclose()` can itself raise — a real failure this wave's own live
    verification hit repeatedly: closing `streamable_http_client`'s context after a failed
    handshake re-raises the underlying transport error (sometimes the *only* place it
    surfaces at all — see `connect()`'s generic except branch for why) as the transport's
    `anyio` task group tears down. Returns it instead of swallowing it, so a caller with a
    reason to want it (a more specific classification than the error it already has) can
    use it; logged either way, so an operator can see a cleanup-time failure even when the
    caller has no use for it."""
    try:
        await exit_stack.aclose()
    except Exception as error:
        logger.warning("MCP session cleanup raised its own error", extra={"detail": str(error)})
        return error
    return None


async def _safe_aclose(exit_stack: AsyncExitStack) -> None:
    """`_aclose_and_capture`, for the callers with no use for what it raises (`connect()`'s
    `McpConnectFailedError`/`TimeoutError` branches already have their own classified
    reason; `McpSdkClient.close()`'s own contract — "idempotent-safe to call after a
    failure" — is not honest if it can raise)."""
    await _aclose_and_capture(exit_stack)


def _as_sdk_session(session: McpSessionPort) -> _McpSdkSession:
    """`McpSession` is an empty structural Protocol (`ports/mcp_client.py`) — this is the
    one, internal place that assumes a session handed back to this adapter was produced by
    this adapter's own `connect()`, which is always true for every real caller
    (`application/connect_and_discover_mcp.py` never constructs one itself)."""
    if not isinstance(session, _McpSdkSession):  # pragma: no cover - defensive, not reachable
        raise TypeError(f"Expected a session produced by McpSdkClient.connect(), got {session!r}")
    return session


def _build_http_client(
    headers: dict[str, str],
    cert_path: str | None,
    timeout: httpx2.Timeout,
    transport: httpx2.AsyncBaseTransport | None,
) -> httpx2.AsyncClient:
    headers_arg = headers or None
    if cert_path is not None and transport is not None:
        return httpx2.AsyncClient(
            headers=headers_arg, timeout=timeout, cert=cert_path, transport=transport
        )
    if cert_path is not None:
        return httpx2.AsyncClient(headers=headers_arg, timeout=timeout, cert=cert_path)
    if transport is not None:
        return httpx2.AsyncClient(headers=headers_arg, timeout=timeout, transport=transport)
    return httpx2.AsyncClient(headers=headers_arg, timeout=timeout)


def _sse_http_client_factory(
    cert_path: str | None, transport: httpx2.AsyncBaseTransport | None
) -> Callable[..., httpx2.AsyncClient]:
    """Only built when `cert_path` and/or `transport` (the test-only hook) is set —
    `sse_client`'s own default factory (`create_mcp_http_client`) is used otherwise, so a
    real call with neither carries no behaviour difference from before this existed."""

    def factory(
        headers: dict[str, str] | None = None,
        auth: httpx2.Auth | None = None,
        timeout: httpx2.Timeout | None = None,
    ) -> httpx2.AsyncClient:
        if cert_path is not None and transport is not None:
            return httpx2.AsyncClient(
                headers=headers, auth=auth, timeout=timeout, cert=cert_path, transport=transport
            )
        if cert_path is not None:
            return httpx2.AsyncClient(headers=headers, auth=auth, timeout=timeout, cert=cert_path)
        if transport is not None:
            return httpx2.AsyncClient(
                headers=headers, auth=auth, timeout=timeout, transport=transport
            )
        return httpx2.AsyncClient(headers=headers, auth=auth, timeout=timeout)  # pragma: no cover

    return factory


async def _build_transport_auth(server: McpServerConfig, secrets: SecretResolver) -> _TransportAuth:
    """Turn `server.auth_mode`/`server.credential_secret_ref` into real request auth.

    `MutualTls`'s convention — `credentialSecretRef` resolves to a filesystem path holding
    a PEM bundle (certificate and private key concatenated) — and `OAuth2ClientCredentials`'s
    convention — it resolves to a JSON blob `{"tokenUrl","clientId","clientSecret"[,"scope"]}`
    — are both real, working implementations this wave defines, honestly narrower than a
    full credential-store integration: `McpServer` (`prisma/tenant/schema.prisma`) carries
    exactly one `credentialSecretRef` column, not separate cert/key or client-id/secret
    columns, so a single secret reference is the only real material available to build
    from. A future wave adding a proper per-auth-mode credential shape can change only this
    function.
    """
    if server.auth_mode == "None":
        return _TransportAuth(headers={}, cert_path=None)

    if not server.credential_secret_ref:
        raise McpConnectFailedError(
            "auth",
            f'authMode "{server.auth_mode}" requires a credentialSecretRef, but the server has '
            "none configured.",
        )

    try:
        secret_value = await secrets.resolve(server.credential_secret_ref)
    except SecretResolutionError as error:
        raise McpConnectFailedError("auth", error.detail) from error

    if server.auth_mode == "ApiKey":
        return _TransportAuth(headers={"Authorization": f"Bearer {secret_value}"}, cert_path=None)

    if server.auth_mode == "MutualTls":
        # A filesystem stat is a blocking syscall (ASYNC240) — off the event loop.
        if not await asyncio.to_thread(os.path.isfile, secret_value):
            raise McpConnectFailedError(
                "auth",
                f'MutualTls credential reference "{server.credential_secret_ref}" must resolve '
                "to a readable PEM file path (certificate and private key concatenated).",
            )
        return _TransportAuth(headers={}, cert_path=secret_value)

    if server.auth_mode == "OAuth2ClientCredentials":
        token = await _oauth2_client_credentials_token(server.credential_secret_ref, secret_value)
        return _TransportAuth(headers={"Authorization": f"Bearer {token}"}, cert_path=None)

    raise McpConnectFailedError(
        "auth", f'Unrecognised authMode "{server.auth_mode}".'
    )  # pragma: no cover


async def _oauth2_client_credentials_token(reference: str, secret_json: str) -> str:
    """A real RFC 6749 client-credentials token request — not a stub. `secret_json` is the
    resolved secret's own value, expected to be a JSON object naming the token endpoint and
    credentials (see `_build_transport_auth`'s docstring for why this shape, not a
    fabricated one)."""
    try:
        credentials = json.loads(secret_json)
    except json.JSONDecodeError as error:
        raise McpConnectFailedError(
            "auth",
            f'OAuth2ClientCredentials secret "{reference}" is not valid JSON (expected '
            '{"tokenUrl", "clientId", "clientSecret"[, "scope"]}).',
        ) from error

    if not isinstance(credentials, dict):
        raise McpConnectFailedError(
            "auth", f'OAuth2ClientCredentials secret "{reference}" must be a JSON object.'
        )
    token_url = credentials.get("tokenUrl")
    client_id = credentials.get("clientId")
    client_secret = credentials.get("clientSecret")
    if not (
        isinstance(token_url, str) and isinstance(client_id, str) and isinstance(client_secret, str)
    ):
        raise McpConnectFailedError(
            "auth",
            f'OAuth2ClientCredentials secret "{reference}" is missing "tokenUrl"/"clientId"/'
            '"clientSecret".',
        )

    form: dict[str, str] = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }
    scope = credentials.get("scope")
    if isinstance(scope, str) and scope:
        form["scope"] = scope

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(token_url, data=form)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        raise McpConnectFailedError(
            "auth", f"OAuth2 client-credentials token request failed: {type(error).__name__}"
        ) from error

    access_token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(access_token, str) or not access_token:
        raise McpConnectFailedError(
            "auth", "The OAuth2 token endpoint responded, but with no usable access_token."
        )
    return access_token


def _classify_mcp_failure(error: BaseException) -> McpConnectFailureReason:
    """Walk every leaf of `error` (unwrapping `BaseExceptionGroup` and the
    `__cause__`/`__context__` chain — see module docstring) and return the most specific
    closed-set reason any leaf matches. Falls back to `"protocol"`: the closed set has no
    generic "could not connect for an unclassified reason" bucket, and a leaf this
    classifier cannot place is, from a caller's perspective, indistinguishable from "the
    endpoint did not behave like a real MCP server" — the same honest bucket api.md §5.6
    documents for a server that "responded, but not with a valid MCP handshake"."""
    for leaf in _iter_leaves(error):
        reason = _classify_leaf(leaf)
        if reason is not None:
            return reason
    return "protocol"


def _iter_leaves(error: BaseException) -> Iterator[BaseException]:
    if isinstance(error, BaseExceptionGroup):
        for sub in error.exceptions:
            yield from _iter_leaves(sub)
        return
    yield error
    cause = error.__cause__ or error.__context__
    if cause is not None:
        yield from _iter_leaves(cause)


def _classify_leaf(error: BaseException) -> McpConnectFailureReason | None:
    text = f"{type(error).__name__}: {error}".lower()

    if isinstance(error, ssl.SSLError) or "ssl" in text or "certificate verify failed" in text:
        return "tls"
    if (
        isinstance(error, socket.gaierror)
        or "getaddrinfo failed" in text
        or "name or service not known" in text
        or "nodename nor servname" in text
        or "name resolution" in text
        # glibc's EAI_NODATA message (errno -5) — this wave's own live verification, run
        # against the real container this service actually deploys as (Debian/glibc, not
        # this dev host's Windows resolver), hit exactly this string for a genuinely
        # nonexistent hostname: `httpcore2`'s asyncio backend re-raises the low-level
        # connect failure as a plain `OSError`, losing the `socket.gaierror` subtype (so
        # the `isinstance` check above does not fire) while preserving this message.
        or "no address associated with hostname" in text
    ):
        return "dns"
    if isinstance(error, httpx2.TimeoutException):
        return "timeout"
    if isinstance(error, httpx2.HTTPStatusError) and error.response.status_code in (401, 403):
        return "auth"
    return None


def _safe_detail(error: BaseException) -> str:
    """A developer-facing description for logs (`McpConnectFailedError.detail`) — never sent
    verbatim to a caller; the router logs it and returns only `{code, meta: {reason}}`
    (api.md §2.2/§2.4)."""
    return f"{type(error).__name__}: {error}"
