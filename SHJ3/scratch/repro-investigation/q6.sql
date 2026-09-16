SET NOCOUNT ON;
PRINT '--- sewa: FlowVersions with no entry node, Draft status ---';
SELECT TOP 5 fv.id AS flowVersionId, fv.flowId, fv.status, fv.entryNodeId, fv.escapeNodeId
FROM sewa.FlowVersions fv
WHERE fv.entryNodeId IS NULL;

PRINT '--- sewa: AgentFlowBindings referencing those ---';
SELECT b.agentVersionId, b.flowVersionId, v.agentId, v.status AS versionStatus, v.isCurrent
FROM sewa.AgentFlowBindings b
JOIN sewa.AgentVersions v ON v.id = b.agentVersionId
WHERE b.flowVersionId IN (SELECT id FROM sewa.FlowVersions WHERE entryNodeId IS NULL);

PRINT '--- sewa: Agent names for those ---';
SELECT a.id, a.name, a.slug, a.status
FROM sewa.Agents a
WHERE a.id IN (
  SELECT v.agentId FROM sewa.AgentVersions v
  WHERE v.id IN (
    SELECT b.agentVersionId FROM sewa.AgentFlowBindings b
    WHERE b.flowVersionId IN (SELECT id FROM sewa.FlowVersions WHERE entryNodeId IS NULL)
  )
);
