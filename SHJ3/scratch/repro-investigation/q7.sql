SET NOCOUNT ON;
PRINT '--- Current FlowNodes for flow version 01M26DWFTNW08PQQKV2NEHGZHN (re-check) ---';
SELECT id, [key], type, title, canvasX, canvasY, conditionExpression FROM sharjah.FlowNodes WHERE flowVersionId = '01M26DWFTNW08PQQKV2NEHGZHN';

PRINT '--- Current FlowVersions row (re-check) ---';
SELECT id, flowId, status, entryNodeId, escapeNodeId, updatedAt FROM sharjah.FlowVersions WHERE id = '01M26DWFTNW08PQQKV2NEHGZHN';

PRINT '--- All FlowVersions for this flow (maybe a newer one was created) ---';
SELECT id, flowId, major, minor, status, isCurrent, entryNodeId, escapeNodeId, updatedAt FROM sharjah.FlowVersions WHERE flowId = '01M26DWFTMMEW3WM4GTBFF95JT' ORDER BY major DESC, minor DESC;

PRINT '--- Current AgentFlowBindings for the draft agent version (re-check) ---';
SELECT id, agentVersionId, flowId, flowVersionId FROM sharjah.AgentFlowBindings WHERE agentVersionId = '01M25RZ1HWRFK08YJGY8ZNFFE5';
