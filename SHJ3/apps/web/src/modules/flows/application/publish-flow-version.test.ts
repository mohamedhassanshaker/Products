import { describe, expect, it } from "vitest";
import { FakeFlowRepository, flowVersionRowFixture } from "../testing/fakes.js";
import { PublishFlowVersion } from "./publish-flow-version.js";

const NOW = new Date("2026-09-11T09:00:00.000Z");

describe("publishing a flow version", () => {
  it("publishes a Draft version that has both entry and escape nodes set", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Draft",
        major: 0,
        minor: 1,
        entryNodeId: "node-start",
        escapeNodeId: "node-escape",
        freeTextEscapeEnabled: true,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: "First publish",
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: true, label: "v1.0" });
    const version = await flows.getFlowVersion("flowver-1");
    expect(version?.status).toBe("Published");
    expect(version?.major).toBe(1);
    expect(version?.minor).toBe(0);
  });

  it("rejects an already-Published version without calling the repository's publishVersion", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Published",
        entryNodeId: "node-start",
        escapeNodeId: "node-escape",
        freeTextEscapeEnabled: true,
        publishedAt: NOW,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: null,
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "flows.already_published" });
  });

  it("rejects when no entry node is set, without ever reaching the repository", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Draft",
        entryNodeId: null,
        escapeNodeId: "node-escape",
        freeTextEscapeEnabled: true,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: null,
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "flows.entry_node_required" });
    expect((await flows.getFlowVersion("flowver-1"))?.status).toBe("Draft");
  });

  it("rejects when no escape node is set", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Draft",
        entryNodeId: "node-start",
        escapeNodeId: null,
        freeTextEscapeEnabled: true,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: null,
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "flows.escape_node_required" });
  });

  it("rejects when freeTextEscapeEnabled is false even if an escape node happens to be set", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Draft",
        entryNodeId: "node-start",
        escapeNodeId: "node-escape",
        freeTextEscapeEnabled: false,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: null,
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "flows.escape_node_required" });
  });

  it("a draft already at major >= 1 (forked off a published version) keeps its own number on re-publish", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(
      flowVersionRowFixture({
        id: "flowver-1",
        flowId: "flow-1",
        status: "Draft",
        major: 1,
        minor: 1,
        entryNodeId: "node-start",
        escapeNodeId: "node-escape",
        freeTextEscapeEnabled: true,
      }),
    );
    const publish = new PublishFlowVersion({ flows });

    const result = await publish.execute({
      flowVersionId: "flowver-1",
      changeSummary: null,
      actorStaffUserId: "staff-1",
      now: NOW,
    });

    expect(result).toEqual({ ok: true, label: "v1.1" });
  });

  it("throws for a version id that does not exist", async () => {
    const flows = new FakeFlowRepository();
    const publish = new PublishFlowVersion({ flows });

    await expect(
      publish.execute({
        flowVersionId: "flowver-missing",
        changeSummary: null,
        actorStaffUserId: "staff-1",
        now: NOW,
      }),
    ).rejects.toThrow(/no such version/i);
  });
});
