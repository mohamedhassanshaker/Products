"""Contract tests for the internal provisioning API.

Two things are being pinned down here, and neither is the happy path.

**The credential gate.** These endpoints are the one place on this surface where the
tenant arrives in the request body rather than being resolved from a principal, so the
usual defence (ADR-0002 rule 1) does not apply and something else has to. mTLS and the
NetworkPolicy establish *which service* is calling; they cannot establish that a call is a
sanctioned platform operation, because ``shj3-web`` is also the caller for every ordinary
tenant-scoped request. Hence the platform-scope credential, and hence the tests that a
missing, wrong or unscoped call is refused before a provisioner is ever constructed.

**Slug validation at the boundary.** The slug becomes a ``:Tenant_<slug>`` label and a
Qdrant collection name — identifier positions with no parameter binding, in the two stores
that have no database boundary beneath them (ADR-0009 rule 3, RISK-024). So the injection
payloads below assert a 422 and, more importantly, that nothing reached the store.

No containers: the provisioners are replaced through ``dependency_overrides``.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound.provisioning_router import (
    get_graph_provisioner,
    get_vector_destroyer,
    get_vector_provisioner,
    router,
)
from shj3_ai.adapters.outbound.graph.graph_provisioner import (
    ErasureProof,
    GraphErasureIncompleteError,
)
from shj3_ai.domain.tenancy import TenantSlug

TOKEN = "test-platform-token"
SCOPED_HEADERS = {"X-SHJ3-Platform-Token": TOKEN, "X-SHJ3-Platform-Scope": "provisioning"}

VECTOR_BODY: dict[str, Any] = {
    "tenantSlug": "sewa",
    "embeddingModel": "text-embedding-3-large",
    "embeddingDimensions": 3072,
}


class FakeGraphProvisioner:
    def __init__(self) -> None:
        self.created: list[TenantSlug] = []
        self.destroyed: list[TenantSlug] = []
        self.verified = True
        self.erasure = ErasureProof(nodes_by_label=0, nodes_by_property=0)
        self.erasure_error: GraphErasureIncompleteError | None = None

    async def create(self, tenant: TenantSlug) -> int:
        self.created.append(tenant)
        return 3

    async def destroy(self, tenant: TenantSlug) -> ErasureProof:
        self.destroyed.append(tenant)
        if self.erasure_error is not None:
            raise self.erasure_error
        return self.erasure

    async def verify(self, tenant: TenantSlug) -> bool:
        return self.verified


class FakeVectorProvisioner:
    def __init__(self) -> None:
        self.created: list[TenantSlug] = []
        self.destroyed: list[TenantSlug] = []
        self.verified = True

    async def create(self, tenant: TenantSlug) -> str:
        self.created.append(tenant)
        return tenant.vector_collection

    async def destroy(self, tenant: TenantSlug) -> None:
        self.destroyed.append(tenant)

    async def verify(self, tenant: TenantSlug) -> bool:
        return self.verified


@pytest.fixture
def graph() -> FakeGraphProvisioner:
    return FakeGraphProvisioner()


@pytest.fixture
def vector() -> FakeVectorProvisioner:
    return FakeVectorProvisioner()


@pytest.fixture
def client(
    graph: FakeGraphProvisioner,
    vector: FakeVectorProvisioner,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    monkeypatch.setenv("SHJ3_AI_PLATFORM_TOKEN", TOKEN)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_graph_provisioner] = lambda: graph
    app.dependency_overrides[get_vector_provisioner] = lambda: vector
    # /vector/destroy resolves its provisioner through a separate dependency
    # (get_vector_destroyer) — it needs no embedding contract, since destroy()
    # never reads it, so it is not built from the request body the way
    # get_vector_provisioner is. Both must point at the same fake so
    # `vector.destroyed` observes calls made through either path.
    app.dependency_overrides[get_vector_destroyer] = lambda: vector
    return TestClient(app)


class TestCredentialGate:
    def test_refuses_a_call_with_no_credential(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/graph/create", json={"tenantSlug": "sewa"}
        )

        assert response.status_code == 403
        assert graph.created == []

    def test_refuses_a_wrong_credential(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/graph/create",
            json={"tenantSlug": "sewa"},
            headers={"X-SHJ3-Platform-Token": "wrong", "X-SHJ3-Platform-Scope": "provisioning"},
        )

        assert response.status_code == 403
        # Identical code for a missing and a wrong credential: distinguishing them is
        # enumeration (api.md §2.2).
        assert response.json()["detail"]["code"] == "authz.permission_denied"
        assert graph.created == []

    def test_refuses_a_correct_credential_presented_without_the_scope(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/graph/create",
            json={"tenantSlug": "sewa"},
            headers={"X-SHJ3-Platform-Token": TOKEN},
        )

        assert response.status_code == 403
        assert graph.created == []

    def test_refuses_every_endpoint_rather_than_the_first(self, client: TestClient) -> None:
        # The gate is declared on the router, so an endpoint added later cannot forget it.
        for path, body in [
            ("graph/create", {"tenantSlug": "sewa"}),
            ("graph/destroy", {"tenantSlug": "sewa"}),
            ("graph/verify", {"tenantSlug": "sewa"}),
            ("vector/create", VECTOR_BODY),
            ("vector/destroy", VECTOR_BODY),
            ("vector/verify", VECTOR_BODY),
        ]:
            response = client.post(f"/v1/internal/provisioning/{path}", json=body)
            assert response.status_code == 403, path

    def test_refuses_when_no_credential_is_configured(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An unconfigured secret must close the endpoint, never open it.
        monkeypatch.delenv("SHJ3_AI_PLATFORM_TOKEN")
        response = client.post(
            "/v1/internal/provisioning/graph/verify",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )
        assert response.status_code == 503


class TestSlugValidation:
    @pytest.mark.parametrize(
        "slug",
        [
            "Tenant_sewa) DETACH DELETE n //",
            "sewa`",
            "sewa-customs",
            "platform",
            "tenant_template",
            "",
            "SEWA",
            "1sewa",
        ],
    )
    def test_rejects_a_slug_that_could_not_safely_become_an_identifier(
        self, client: TestClient, graph: FakeGraphProvisioner, slug: str
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/graph/create",
            json={"tenantSlug": slug},
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 422
        # The assertion that matters: nothing reached the store.
        assert graph.created == []

    def test_does_not_echo_the_offending_value(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        payload = "sewa'; DROP SCHEMA x --"
        response = client.post(
            "/v1/internal/provisioning/vector/create",
            json={**VECTOR_BODY, "tenantSlug": payload},
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 422
        assert payload not in response.text


class TestGraphEndpoints:
    def test_create_reports_the_objects_it_made(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/graph/create",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 200
        assert response.json() == {"indexesCreated": 3}
        assert graph.created == [TenantSlug("sewa")]

    def test_destroy_returns_the_erasure_proof(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        # The counts are carried back verbatim so RB-12's attestation can quote them
        # rather than restating "we ran the delete".
        response = client.post(
            "/v1/internal/provisioning/graph/destroy",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 200
        assert response.json() == {"nodesByLabel": 0, "nodesByProperty": 0}

    def test_unproven_erasure_is_a_conflict_carrying_the_residual_counts(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        proof = ErasureProof(nodes_by_label=0, nodes_by_property=7)
        graph.erasure_error = GraphErasureIncompleteError(TenantSlug("sewa"), proof, 1)

        response = client.post(
            "/v1/internal/provisioning/graph/destroy",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )

        # 409, not 500: nothing failed, the operation simply cannot claim completeness.
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "knowledge.graph_erasure_incomplete"
        assert detail["nodesByProperty"] == 7

    def test_verify_forwards_the_answer(
        self, client: TestClient, graph: FakeGraphProvisioner
    ) -> None:
        graph.verified = False
        response = client.post(
            "/v1/internal/provisioning/graph/verify",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )
        assert response.json() == {"verified": False}


class TestVectorEndpoints:
    def test_create_returns_the_derived_collection_name(
        self, client: TestClient, vector: FakeVectorProvisioner
    ) -> None:
        response = client.post(
            "/v1/internal/provisioning/vector/create",
            json=VECTOR_BODY,
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 200
        assert response.json() == {"collection": "sewa_knowledge"}
        assert vector.created == [TenantSlug("sewa")]

    def test_rejects_a_request_with_no_embedding_contract(self, client: TestClient) -> None:
        # The model and dimension are not recoverable by inspection later (RB-09 step 3),
        # so a collection may not be created without them.
        response = client.post(
            "/v1/internal/provisioning/vector/create",
            json={"tenantSlug": "sewa"},
            headers=SCOPED_HEADERS,
        )
        assert response.status_code == 422

    def test_rejects_a_nonsensical_dimension(self, client: TestClient) -> None:
        response = client.post(
            "/v1/internal/provisioning/vector/create",
            json={**VECTOR_BODY, "embeddingDimensions": 0},
            headers=SCOPED_HEADERS,
        )
        assert response.status_code == 422

    def test_destroy_is_accepted(self, client: TestClient, vector: FakeVectorProvisioner) -> None:
        response = client.post(
            "/v1/internal/provisioning/vector/destroy",
            json=VECTOR_BODY,
            headers=SCOPED_HEADERS,
        )

        assert response.status_code == 200
        assert vector.destroyed == [TenantSlug("sewa")]

    def test_verify_forwards_the_answer(
        self, client: TestClient, vector: FakeVectorProvisioner
    ) -> None:
        vector.verified = False
        response = client.post(
            "/v1/internal/provisioning/vector/verify",
            json=VECTOR_BODY,
            headers=SCOPED_HEADERS,
        )
        assert response.json() == {"verified": False}
