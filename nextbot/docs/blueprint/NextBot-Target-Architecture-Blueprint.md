**NEXTBOT PLATFORM**

**Target Architecture and**

**Enhancement Blueprint**

A senior-architecture review of the NextBot conversational AI platform,
a gap analysis against the current screen inventory, and the detailed
design of six new or restructured modules: the MCP Definition Registry,
the Knowledge and Graph RAG subsystem, Skills and the Agent Design
Studio, the Workflow Designer, Multi-agent Orchestration, and Model
Gateway v2.

Includes suggested wireframes for every new screen.

  -----------------------------------------------------------------------
  **Field**         **Value**
  ----------------- -----------------------------------------------------
  **Document**      NextBot --- Target Architecture and Enhancement
                    Blueprint

  **Version**       1.0

  **Status**        For architecture review

  **Date**          28 August 2026

  **Basis**         NextBot --- Screen Reference (live seeded instance)

  **Audience**      Platform engineering, product, security, and delivery
                    leadership

  **Scope**         Admin Console, Agent Platform, Platform Manager
                    console, customer widget
  -----------------------------------------------------------------------

**Contents**

**1. Executive summary**

NextBot today is a well-built tenant-facing conversational AI console
with an unusually disciplined security posture. Access control fails
closed at every screen, agent versions are immutable, promotion to
production requires a passing eval run plus an approver who is not the
author plus a real sandbox conversation, and high-risk tool calls stop
at a human approval queue. These are the right foundations and this
document treats them as constraints, not as things to be redesigned.

The platform is, however, missing several subsystems that its own
architecture implies. It has no knowledge layer, so an agent can only
reach information through an MCP tool call. It has no way to manage the
MCP servers it depends on beyond a connection form, so a server that
changes its tool schemas can silently change agent behaviour in
production. It has no reusable unit of agent capability, so every agent
version is authored from scratch. It has no orchestration, so a channel
talks to exactly one agent. And its model gateway treats a model as a
free-text string typed into a form, which is untenable across the
provider landscape the platform will need to support.

This document proposes six modules that close those gaps while
preserving the platform\'s existing guarantees:

  --------------------------------------------------------------------------
  **Module**        **Status today**       **Proposal**
  ----------------- ---------------------- ---------------------------------
  **MCP Definition  Partially exists as    Promote to a governed enrolment
  Registry**        /connectors --- a      lifecycle with pinned manifests,
                    connection form with   drift quarantine, capability
                    health                 groups, and per-environment
                                           binding

  **Knowledge and   Absent entirely        A graph-indexed knowledge
  Graph RAG**                              subsystem with entity and
                                           relation extraction, community
                                           summarisation, three retrieval
                                           strategies, and a bounded
                                           retrieval agent

  **Skills and      Text mode and Design   Skills as a first-class versioned
  Agent Design      mode exist; no         artifact, plus a guided studio
  Studio**          reusable unit          that composes them into the same
                                           immutable YAML

  **Workflow        Absent entirely        A versioned orchestration graph,
  Designer**                               authored as YAML, promoted
                                           through the existing gate

  **Multi-agent     Absent entirely        Supervisor and specialist teams,
  Orchestration**                          where a specialist is registered
                                           as a tool so delegation inherits
                                           tiering, permissions, and audit

  **Model Gateway   Routes plus a          A three-layer provider / model
  v2**              read-only provider     catalogue / route model spanning
                    list; model names are  Anthropic, OpenAI, Google,
                    typed strings          OpenRouter, Azure, Bedrock, vLLM,
                                           Ollama and any OpenAI-compatible
                                           endpoint
  --------------------------------------------------------------------------

Three of these changes are load-bearing for the others. Model Gateway v2
must land before the knowledge subsystem, because a knowledge index pins
an embedding model and cannot do so against a free-text string. Skills
must land before the Studio, or the Studio is only a longer form. And
version pinning --- of MCP manifests, skills, model routes, and agent
versions --- must be designed in from the first line of code, because
retrofitting it means auditing every artifact already in production.

+-----------------------------------------------------------------------+
| **The single most important rule in this document**                   |
|                                                                       |
| Every new artifact is versioned, immutable once promoted, and pins    |
| the version of everything it references.                              |
|                                                                       |
| A skill, an MCP manifest, a model route, or a member agent that can   |
| change underneath a promoted agent version destroys the platform\'s   |
| strongest existing property: that what is running in production is    |
| exactly what was reviewed.                                            |
+-----------------------------------------------------------------------+

**2. Scope and method**

This review is based on the NextBot Screen Reference, a screen-by-screen
description of the live seeded platform covering the authentication
screens, the tenant Admin Console, the Agent Platform, tenant Settings,
the cross-tenant Platform Manager console, and the customer-facing
widget.

**2.1 What is in scope**

- The tenant-facing Admin Console and Agent Platform, where the six
  proposed modules live.

- Cross-cutting concerns that the new modules touch: permissions, PII
  handling, audit attribution, observability, cost, and data residency.

- The data model additions each module requires.

- Suggested wireframes for every new screen, included inline and indexed
  in Appendix A.

**2.2 What is out of scope**

- The customer-facing widget\'s visual design, beyond the requirement
  that it render citations produced by the knowledge subsystem.

- Platform Manager console changes, other than the plan-tier controls
  needed to govern which provider types a tenant may use.

- Commercial packaging, pricing, and contractual data-processing terms.

- Detailed API contracts, which follow once the module boundaries in
  this document are agreed.

**2.3 How to read the module sections**

Sections 6 to 11 follow a consistent shape: what exists today and why it
is insufficient, the proposed screens, the domain model, the rules the
runtime must enforce rather than the UI, and the wireframes. Where a
rule appears in a highlighted box, it is a rule that cannot be delegated
to prompt instructions or to the interface --- it has to be enforced by
the platform, or it is not enforced at all.

**3. Current platform baseline**

**3.1 Screen inventory**

The following inventory is derived from the Screen Reference. Module
names in the third column are the permission modules that gate each
screen, read/write/none per role.

  ----------------------------------------------------------------------------------------
  **Area**             **Screens**                                    **Permission
                                                                      module**
  -------------------- ---------------------------------------------- --------------------
  **Authentication**   Login with tenant slug, TOTP MFA and backup    ---
                       codes; forgot password with non-enumerable     
                       response; separate Platform Manager login      
                       behind an operator token and IP allowlist      

  **Operations**       Dashboard with conversation volume, escalation reporting
                       rate and tool-call activity                    

  **Operations**       Conversations list and detail, with            conversations
                       transcript, collapsible reasoning trace and    
                       tool calls                                     

  **Operations**       Approval Queue for Tier-3 tool calls awaiting  approval_queue
                       a human decision                               

  **Operations**       Escalation Queue and live takeover panel       escalations

  **Operations**       Channels list, add-channel type picker,        channels
                       per-type setup, and an in-console channel test 
                       running the deployed Production version        

  **Integration**      Connectors list, add form and detail with live connectors
                       health                                         

  **Integration**      Tool Catalog with read/write class and         tool_permissions,
                       approval tier; per-tool permission rules with  agent_tool_config
                       a simulate preview                             

  **Integration**      MCP Health with a health tab and an alert      connectors
                       configuration tab                              

  **Agent Platform**   Agent definitions and versions; create/edit a  agent_platform
                       version in Text or Design mode; version detail 
                       with Overview, Eval and Sandbox tabs; eval     
                       suites; model gateway; runtime traces;         
                       Git-backed diff                                

  **Settings**         Settings hub, branding and white-label,        security_settings,
                       escalation routing, Git integration, PII and   escalations,
                       guardrails, retention and residency, data      agent_platform
                       subject requests                               

  **Administration**   Users and roles with the permission matrix     users_roles,
                       editor; audit log with actor attribution       audit_log

  **Platform Manager** Tenant list, detail and provisioning; plan     operator token
                       tiers; cross-tenant connector health rollup    
  ----------------------------------------------------------------------------------------

**3.2 Architectural invariants worth preserving**

These are the decisions that constrain every proposal in this document.
Each one is currently honoured consistently, and each one is easy to
break accidentally when adding the modules below.

  ---------------------------------------------------------------------------
  **Invariant**   **How it manifests today**     **Risk introduced by the new
                                                 modules**
  --------------- ------------------------------ ----------------------------
  **Fail closed** A role without access sees an  New screens and new node
                  explicit no-access state on a  types must inherit the same
                  direct link. Settings hub      default-deny posture rather
                  cards are hidden per role.     than defaulting to visible.
                  Unconfigured masking-context   
                  combinations default to full   
                  masking. The Platform Manager  
                  console is indistinguishable   
                  from a missing page.           

  **Immutable     Agent versions never change    Skills, routes and team
  versions**      after creation. Restore        members referenced by name
                  authors a new version          rather than by version would
                  pre-filled from an old one     silently mutate a promoted
                  rather than mutating it.       version.

  **The promotion Production requires a passing  Wizards, workflows and teams
  gate**          eval run, an approver who is   must all land in Draft and
                  not the author, and at least   pass the same gate. None may
                  one completed sandbox          bypass it.
                  conversation.                  

  **Tool          Tier 1 runs automatically,     A Tier-3 tool invoked from
  tiering**       Tier 2 is logged, Tier 3 stops inside a workflow node or a
                  at the Approval Queue.         delegated sub-agent must
                                                 still stop at the queue.

  **Credentials   Connector credentials are      Provider credentials in
  never           stored in an encrypted vault   Model Gateway v2 and MCP
  returned**      and never shown back in        enrolment must use the same
                  plaintext once saved.          vault, not a new store.

  **One widget    The customer widget is a       Team and workflow sandboxes
  artifact**      standalone application reused  must reuse the same widget
                  for the channel test and the   rather than introducing a
                  version sandbox, so what is    lighter mock.
                  tested is what customers get.  

  **Separate      Every Platform Manager         Multi-agent runs must extend
  audit trails**  mutation writes to a           tenant audit attribution to
                  platform-level audit trail,    a delegation chain rather
                  separate from any tenant\'s    than logging a bare agent
                  own log.                       name.
  ---------------------------------------------------------------------------

**4. Gap analysis**

Gaps are rated by the risk they carry today, not by implementation
effort. Severity 1 means an incident is likely and recovery is currently
slow or impossible; severity 2 means a capability the platform is
expected to have is absent; severity 3 means an operational or
commercial limitation.

  ----------------------------------------------------------------------------------------
  **ID**     **Gap**               **Consequence**                 **Sev**   **Addressed
                                                                             in**
  ---------- --------------------- ------------------------------- --------- -------------
  **G-01**   No knowledge or       An agent can only reach         1         §7
             retrieval layer of    information through a tool                
             any kind              call. No document grounding, no           
                                   citations, no content-coverage            
                                   reporting.                                

  **G-02**   No rollback path      Promotion replaces the prior    1         §14
                                   production deployment.                    
                                   Restoring an older version                
                                   creates a new version that must           
                                   re-pass the full gate, so                 
                                   recovery is slower than causing           
                                   the outage.                               

  **G-03**   MCP manifests are not A server that adds a tool or    1         §6
             pinned                changes an approved tool\'s               
                                   input schema changes agent                
                                   behaviour with no review and no           
                                   alert.                                    

  **G-04**   No guardrail on tool  A Fetch-class connector returns 1         §12.2
             output                attacker-controlled text                  
                                   straight into the model                   
                                   context. Injection is currently           
                                   unguarded, and will propagate             
                                   across agents once delegation             
                                   exists.                                   

  **G-05**   Model is a free-text  No capability metadata, no      1         §11
             string                price, no context window, no              
                                   deprecation signal. A version             
                                   can be saved that requests tool           
                                   calling from a model that does            
                                   not support it, failing only at           
                                   runtime.                                  

  **G-06**   Capability groups are Design mode offers a picker for 2         §6.3
             referenced but        Tool Registry capability                  
             unauthorable          groups, but no screen anywhere            
                                   creates or edits them.                    

  **G-07**   Diff requires a Git   Versions can be authored        2         §8.5
             commit on both        without Git, so the majority              
             versions              path has no diff at all on a              
                                   platform whose core artifact is           
                                   a YAML document.                          

  **G-08**   Evals are             No harvesting of production     2         §8.4
             pre-deployment and    conversations into cases, no              
             hand-authored only    continuous run against                    
                                   production to catch provider              
                                   drift, no LLM-judge grading, no           
                                   regression baseline.                      

  **G-09**   No reusable unit of   Every version is authored from  2         §8
             agent capability      scratch; eval cases are written           
                                   separately from the behaviour             
                                   they test.                                

  **G-10**   A channel talks to    No orchestration, no specialist 2         §9, §10
             exactly one agent     routing, no deterministic                 
                                   branching, no long-running                
                                   process.                                  

  **G-11**   No tenant-facing cost Quotas exist only in the        2         §11.6
             or usage view         Platform Manager console. A               
                                   tenant cannot see spend by                
                                   agent, route or model, and                
                                   learns about a limit when it is           
                                   hit.                                      

  **G-12**   No SSO or SCIM        Password plus TOTP only, on a   2         §12.6
                                   platform sold with an                     
                                   Enterprise tier, residency                
                                   controls and a DSR screen.                
                                   Blocks enterprise procurement             
                                   independent of product quality.           

  **G-13**   No public API or      Everything is console-driven.   2         §12.6
             webhooks              NextBot can call out to                   
                                   systems; systems cannot drive             
                                   NextBot.                                  

  **G-14**   Escalation queue      No assignment, SLA timers,      2         §12.5
             lacks workforce       agent presence, concurrency               
             mechanics             limits or CSAT capture. Routing           
                                   to an unwatched queue is silent           
                                   failure.                                  

  **G-15**   Observability stops   No OpenTelemetry export, no     3         §12.4
             at the tenant         SIEM streaming of the audit               
             boundary              log, no synthetic monitoring.             
                                   The operator health rollup is             
                                   deliberately metadata-only,               
                                   leaving no consented path to              
                                   diagnose a tenant quality                 
                                   regression.                               

  **G-16**   Two channel types, no The same customer on WhatsApp   3         §12.5
             cross-channel         and web is two unrelated                  
             identity              conversations with no shared              
                                   context.                                  

  **G-17**   No configuration      Retention and Residency covers  3         §12.4
             export or restore     purge and region, not                     
                                   recoverability. There is no               
                                   backup of a tenant\'s agent,              
                                   connector and policy                      
                                   configuration.                            

  **G-18**   One Git connection    Caps a large tenant at a single 3         §8.5
             per tenant            repository across all teams and           
                                   agent definitions.                        
  ----------------------------------------------------------------------------------------

**5. Target architecture**

**5.1 The composition model**

The six modules are not independent features. They form a chain in which
each layer is a versioned artifact that pins the layer beneath it.
Reading upward: MCP servers expose tools and resources; capability
groups curate those tools into named sets; skills bundle a capability
with the tools, knowledge and eval cases it needs; an agent version
composes skills; a workflow or a team composes agent versions; and a
channel binds to one workflow, team or agent version.

  ---------------------------------------------------------------------------------
  **Layer**   **Artifact**      **Pins**              **Versioned**   **Promoted
                                                                      through the
                                                                      gate**
  ----------- ----------------- --------------------- --------------- -------------
  **1**       MCP server        Endpoint, credential, Yes             No ---
              definition        manifest hash                         reviewed at
                                                                      enrolment and
                                                                      on drift

  **2**       Capability group  A set of tool         Yes             No
                                identities                            

  **3**       Knowledge         Sources, embedding    Yes (index      No
              collection        model, index build    generation)     

  **4**       Skill             Tools, capability     Yes             No ---
                                groups, knowledge                     validated,
                                scopes, eval cases                    not promoted

  **5**       Agent version     Skills, model routes, Yes, immutable  Yes
                                knowledge scopes,                     
                                guardrails                            

  **6**       Workflow version  Agent versions,       Yes, immutable  Yes
              / Team version    skills, tools,                        
                                sub-workflows                         

  **7**       Channel binding   One production        Deployment      Deployment
                                workflow, team or     record          action
                                agent version                         
  ---------------------------------------------------------------------------------

**5.2 New and changed permission modules**

The platform gates screens by permission module, read/write/none per
role. The proposal adds four modules and re-scopes one, keeping the
existing split whereby seeing a configuration and changing it can be
granted separately.

  ----------------------------------------------------------------------------------
  **Module**             **New or    **Gates**
                         changed**   
  ---------------------- ----------- -----------------------------------------------
  **mcp_registry**       New         Server enrolment, manifest review, drift
                                     acceptance, capability group management

  **knowledge**          New         Collections, sources, ingestion pipeline, graph
                                     explorer, retrieval playground

  **knowledge_config**   New         Which embedding and rerank models a collection
                                     uses, chunking and extraction policy ---
                                     separated so a curator can add sources without
                                     changing retrieval behaviour

  **workflows**          New         Workflow and team definitions, canvas, run
                                     history

  **agent_platform**     Changed     Now also gates skills and the Agent Design
                                     Studio; model gateway remains under it
  ----------------------------------------------------------------------------------

**5.3 Design principles applied throughout**

1.  The YAML is the artifact. Every authoring surface --- Design mode,
    the Studio wizard, the workflow canvas, the team editor --- is a
    renderer over a YAML document validated by one validator. No surface
    may express something the schema cannot, and no surface may bypass
    validation.

2.  Every reference is version-pinned at compose time. Names are for
    humans; the stored artifact records skill@3, server@7, route@12,
    agent@9.

3.  Permissions compose by intersection, never union. Delegation,
    composition and orchestration may narrow scope. They may never widen
    it.

4.  Tenant policy can be tightened by an artifact, never loosened. An
    agent version that relaxes tenant PII masking fails validation
    rather than being blocked only in the interface.

5.  Reuse the existing control surfaces. Human decisions go to the
    Approval Queue or the Escalation Queue. Delegation goes through the
    Tool Catalog. New queues and parallel permission systems are how
    governance drifts out of sync.

6.  Cost, latency and depth are enforced by the runtime. Budgets written
    into a system prompt are advisory; budgets enforced by the executor
    are real.

**6. Module A --- MCP Definition Registry**

**6.1 What exists today and why it is insufficient**

The Connectors screens handle the operational concern well: a form
captures name, description, backend type, environment, transport
(streamable HTTP or a gateway-mediated stdio process), endpoint URL and
an authentication method, with the credential itself held in the
encrypted vault and never returned in plaintext; the detail page shows
live health. The Tool Catalog then lists every tool discovered across
every connector, tagged with a read/write classification and an approval
tier, with per-tool allow and deny rules and a simulate preview.

That is a connection manager. It is not an enrolment lifecycle, and four
things are missing as a result.

  -----------------------------------------------------------------------
  **Missing**       **Consequence**
  ----------------- -----------------------------------------------------
  **No pinned       There is no recorded snapshot of what a server
  manifest**        exposed at the moment it was approved, so there is
                    nothing to compare against. A server that adds a
                    tool, removes one, or changes an approved tool\'s
                    input schema changes what agents can do with no
                    review and no alert. This is the clearest
                    privilege-escalation path in the platform today.

  **Only tools are  MCP servers expose tools, resources and prompts.
  modelled**        Resources are the natural feed into the knowledge
                    subsystem in §7 and are currently discarded.

  **Capability      Design mode offers a picker for Tool Registry
  groups are        capability groups such as \"Knowledge and Web\" or
  unauthorable**    \"DevOps and Code\", but no screen creates, edits or
                    audits them.

  **No environment  One logical server with development, staging and
  binding**         production endpoints is three unrelated connector
                    rows with three unrelated tool lists and three
                    unrelated health histories.
  -----------------------------------------------------------------------

**6.2 Proposed screens**

  -----------------------------------------------------------------------------------
  **Route**                       **Purpose**
  ------------------------------- ---------------------------------------------------
  **/mcp/servers**                Registry list: server, transport, environments
                                  bound, tool count, manifest state and health

  **/mcp/servers/new**            Nine-step enrolment wizard

  **/mcp/servers/\[id\]**         Definition detail --- tabs for Manifest, Tools,
                                  Resources, Prompts, Policy, Environments, Versions
                                  and Health

  **/mcp/servers/\[id\]/drift**   Diff of the live manifest against the pinned
                                  manifest, with an accept or reject review

  **/mcp/capability-groups**      Create and edit the groups consumed by the Design
                                  mode and Studio pickers
  -----------------------------------------------------------------------------------

![](./media/f97e9bd109c6f21251434ec24340177e407d59ba.png){width="6.25in"
height="2.4166666666666665in"}

*Figure 1 --- MCP registry list. Manifest state is a first-class column:
pinned, drifting, or quarantined.*

**6.3 The enrolment wizard**

1.  Identify --- name, description, owner, backend type, business
    criticality.

2.  Transport and endpoint --- streamable HTTP or gateway-mediated
    stdio, with a separate endpoint per environment rather than a
    separate connector per environment.

3.  Authentication --- method plus credential, written straight to the
    existing encrypted vault. Sandbox and production credentials are
    captured separately so that version sandbox testing never reaches
    live systems.

4.  Discovery handshake --- connect, enumerate tools, resources and
    prompts, capture the JSON schemas, and hash the whole response into
    a pinned manifest.

5.  Classification --- read or write, and approval tier, per tool.
    Pre-filled by a heuristic over the tool schema and description,
    confirmed by a human. Anything unclassified defaults to Tier 3 and
    disabled.

6.  Grouping --- assign tools to capability groups.

7.  Runtime policy --- timeout, retry, circuit-breaker threshold,
    per-tool rate limit, cost attribution tag and egress allowlist.

8.  Dry run --- invoke one read-only tool against the sandbox credential
    and show the raw result before anything is enrolled.

9.  Enrol --- writes the definition and the manifest hash to the audit
    log.

![](./media/8f38d0668c5ddda15f829f2128e034395e0ee8af.png){width="6.25in"
height="2.9791666666666665in"}

*Figure 2 --- Enrolment wizard, discovery and classification step.
Write-classified tools cannot be auto-approved to Tier 1 from this
screen.*

**6.4 Rules the runtime must enforce**

+-----------------------------------------------------------------------+
| **Manifest pinning and drift quarantine**                             |
|                                                                       |
| A reconciler re-fetches each server\'s manifest on a schedule and     |
| compares it to the pinned hash.                                       |
|                                                                       |
| A newly appeared tool enrols as disabled and Tier 3 until a human     |
| reviews it.                                                           |
|                                                                       |
| A changed input schema on an already-approved tool is treated as a    |
| new tool, not as an update --- because that is exactly the vector by  |
| which a compromised or updated server escalates its own privileges.   |
|                                                                       |
| An agent version records the server definition version it was         |
| validated against, so drift surfaces as a warning on the agent rather |
| than as changed behaviour in production.                              |
+-----------------------------------------------------------------------+

- Server definitions are versioned and immutable, so an agent version
  can pin server@definitionVersion and be reproducible.

- Resources discovered on a server are offered as ingestion candidates
  to the knowledge subsystem rather than being discarded.

- Health, alerting and error classification remain where they are today,
  on the MCP Health screen; the registry links to it rather than
  duplicating it.

**6.5 Data model additions**

  -----------------------------------------------------------------------------------
  **Entity**                    **Key fields**
  ----------------------------- -----------------------------------------------------
  **mcp_server**                id, tenant_id, name, backend_type, criticality,
                                owner, status, created_by

  **mcp_server_version**        id, server_id, version, transport, auth_method,
                                credential_ref, policy_json, manifest_hash,
                                approved_by, approved_at

  **mcp_environment_binding**   id, server_version_id, environment, endpoint_url,
                                credential_ref, reachable_at

  **mcp_manifest_item**         id, server_version_id, kind (tool\|resource\|prompt),
                                name, schema_json, schema_hash, io_class,
                                approval_tier, enabled

  **mcp_drift_event**           id, server_id, detected_at, change_kind, item_name,
                                old_schema_hash, new_schema_hash, resolution,
                                resolved_by

  **capability_group**          id, tenant_id, name, description

  **capability_group_item**     group_id, server_id, tool_name
  -----------------------------------------------------------------------------------

**7. Module B --- Knowledge and Graph RAG**

**7.1 Why a graph, and not only a vector index**

The largest structural gap in the platform is that there is no knowledge
layer at all. The only route to information is an MCP tool call, which
means a tenant cannot upload a policy document and have an agent ground
its answers in it, the conversation detail view has no citation panel,
and there is no reporting on what customers asked that the tenant has no
content for.

Plain vector retrieval solves part of this and fails on the questions
support agents are actually asked. A question such as \"can a customer
dispute a charge after the refund window closes\" depends on a
relationship between three concepts --- the dispute window, the
chargeback rule and the refund policy --- that never appear together in
a single chunk. Top-k similarity returns chunks about each concept and
the model is left to infer a connection it was never shown.

A graph index fixes this by extracting entities and the relations
between them at ingestion time, so retrieval can walk from an anchor
entity to its neighbours and return the relation path itself as
evidence. It also enables a second retrieval mode that vector search
cannot offer at all: summarising an entire thematic community of the
graph to answer broad questions such as \"what does our refund policy
actually cover\".

**7.2 Ingestion pipeline**

  --------------------------------------------------------------------------
  **Stage**     **What happens**                    **Notes**
  ------------- ----------------------------------- ------------------------
  **Ingest**    Files, crawled URLs, MCP resources  Source ACLs are captured
                from the registry, or connector     here and carried through
                syncs                               to every chunk

  **Parse**     Text, tables and layout extraction; Tables are preserved as
                OCR where needed                    structured blocks, not
                                                    flattened to prose

  **Chunk**     Semantic chunking with configurable Chunk provenance records
                size and overlap                    document, page and
                                                    section

  **Extract     An LLM pass produces entities,      Runs on a cheap route
  entities**    types, relations and claims per     --- see §11; this is the
                chunk                               dominant ingestion cost

  **Resolve**   Canonicalisation and deduplication  Deterministic rules plus
                of entity mentions across documents embedding similarity,
                                                    with a human review
                                                    queue for low-confidence
                                                    merges

  **Build       Nodes, typed edges and provenance   Every edge keeps the
  graph**       written to the graph store          chunk it came from

  **Community   Hierarchical clustering of the      Leiden or equivalent;
  detection**   graph into thematic communities     communities are what
                                                    global retrieval
                                                    summarises

  **Community   A summary is generated per          Regenerated
  summaries**   community at each level             incrementally when
                                                    member entities change

  **Embed**     Chunks, entity summaries and        Embedding model is
                community summaries are embedded    pinned to the index
                                                    generation

  **Index**     Vector index plus graph store,      Honours Settings \>
                region-pinned per tenant            Retention and Residency
  --------------------------------------------------------------------------

![](./media/49490288c5d07a944a6ae3eaf0a2a69e5b812a7c.png){width="6.25in"
height="2.53125in"}

*Figure 3 --- Knowledge collections with the ingestion pipeline for one
collection. Index status distinguishes built, re-embedding and stale.*

+-----------------------------------------------------------------------+
| **The embedding model is part of the index, not a setting**           |
|                                                                       |
| A collection records provider, model and dimension from the Model     |
| Gateway catalogue at build time.                                      |
|                                                                       |
| Changing the embedding model invalidates the index and forces a full  |
| re-embed. It is never a silent swap, and the screen must say so       |
| before the change is accepted.                                        |
|                                                                       |
| This is the dependency that makes Model Gateway v2 a prerequisite for |
| this module rather than a parallel workstream.                        |
+-----------------------------------------------------------------------+

**7.3 The graph explorer**

Curators need to see what was extracted, because extraction quality is
the single largest determinant of retrieval quality and it is invisible
in a pure vector system. The explorer shows entities, their relations,
the community they belong to and --- critically --- the provenance of
every relation, so a wrong answer can be traced to the sentence that
produced the wrong edge.

![](./media/44a1e7d5ed930103d094cc821053977cdf56f1e0.png){width="6.25in"
height="3.1979166666666665in"}

*Figure 4 --- Graph explorer with an entity inspector. Every relation
carries provenance back to the source chunk.*

**7.4 Retrieval strategies**

  ----------------------------------------------------------------------------
  **Strategy**   **How it works**               **Best for**      **Relative
                                                                  cost**
  -------------- ------------------------------ ----------------- ------------
  **Vector**     Top-k similarity over chunk    Lookup questions  Lowest
                 embeddings                     answered by a     
                                                single passage    

  **Graph        Anchor on entities mentioned   Questions whose   Low to
  local**        in the query, walk N hops,     answer spans      medium
                 return neighbour chunks plus   related concepts  
                 the relation path                                

  **Graph        Map over community summaries,  Broad, thematic   Highest
  global**       reduce to an answer            or \"what does    
                                                our policy        
                                                cover\" questions 

  **Hybrid**     Vector recall, then graph      Default when the  Medium
                 expansion of the top entities, query classifier  
                 then rerank                    is uncertain      
  ----------------------------------------------------------------------------

![](./media/e635842fc594b58f976af0915f2cad08f5ba15ef.png){width="6.25in"
height="3.0625in"}

*Figure 5 --- Retrieval playground comparing three strategies on one
query, with groundedness, latency and cost per strategy.*

**7.5 The retrieval agent**

Retrieval is not a single call. An effective retrieval agent plans,
retrieves, assesses whether what it has is sufficient, expands if not,
and answers with citations --- bounded so that it cannot loop.

*Retrieval configuration, expressed in the same version YAML as
everything else.*

+-----------------------------------------------------------------------+
| kind: agentVersion                                                    |
|                                                                       |
| name: retrieval_agent                                                 |
|                                                                       |
| modelRoute: chat.primary \# answering                                 |
|                                                                       |
| plannerRoute: chat.router \# classification and sufficiency checks    |
|                                                                       |
| knowledge:                                                            |
|                                                                       |
| collections: \[billing_policy@12, legal@4\]                           |
|                                                                       |
| strategy: auto \# vector \| local \| global \| hybrid \| auto         |
|                                                                       |
| maxHops: 2                                                            |
|                                                                       |
| maxExpansions: 3                                                      |
|                                                                       |
| minCitations: 1                                                       |
|                                                                       |
| refuseWhenUngrounded: true                                            |
|                                                                       |
| budget:                                                               |
|                                                                       |
| usdPerTurn: 0.02                                                      |
|                                                                       |
| seconds: 8                                                            |
+-----------------------------------------------------------------------+

- Query classification chooses the strategy: narrow entity questions go
  local, broad thematic questions go global, and anything without a
  graph anchor falls back to vector.

- A sufficiency check after each retrieval decides whether to expand
  another hop or answer. Expansion is capped, so retrieval cannot loop
  indefinitely.

- refuseWhenUngrounded is the single most valuable setting in this
  block. An agent that says it does not know is worth more than one that
  fills the gap, and this is enforced by the runtime rejecting an answer
  with no citations, not by asking the model nicely.

- Citations are returned as structured references --- collection,
  document, chunk and, for graph retrieval, the relation path --- and
  rendered in Conversations, Runtime Traces and the customer widget.

**7.6 Governance**

  -------------------------------------------------------------------------
  **Concern**     **Rule**
  --------------- ---------------------------------------------------------
  **Access        Source ACLs are captured at ingestion and carried to
  control**       every chunk, entity and edge. Retrieval filters by the
                  requesting agent\'s scope before ranking, never after. A
                  chunk the caller may not see must not influence the
                  ranking of chunks it may.

  **PII**         Tenant PII detection rules run at ingestion. Detected
                  entities are masked at index time according to the
                  masking-context matrix for the collection\'s trust level,
                  and re-evaluated at read time for the requesting agent\'s
                  trust level.

  **Residency**   The index, the graph store and the embedding provider
                  must all satisfy the tenant\'s storage region and
                  out-of-region inference setting. A route that would send
                  chunks out of region is rejected at collection
                  configuration time.

  **Retention**   Collections inherit the tenant retention policy. A purged
                  source removes its chunks, its extracted entities where
                  they have no other provenance, and triggers community
                  re-summarisation.

  **Freshness**   Incremental re-ingestion with delta entity resolution.
                  Collections show a staleness badge; an agent version can
                  declare a maximum acceptable staleness and refuse rather
                  than answer from a stale index.

  **Coverage**    A coverage tab reports questions asked in production that
                  retrieved nothing above threshold --- the content
                  backlog, generated from real demand rather than guessed.
  -------------------------------------------------------------------------

**7.7 Data model additions**

  ------------------------------------------------------------------------------------
  **Entity**                       **Key fields**
  -------------------------------- ---------------------------------------------------
  **knowledge_collection**         id, tenant_id, name, region, retention_days,
                                   trust_level, status

  **knowledge_source**             id, collection_id, kind
                                   (upload\|url\|mcp_resource\|connector), locator,
                                   acl_json, last_synced_at

  **knowledge_index_generation**   id, collection_id, generation,
                                   embedding_provider_id, embedding_model_id,
                                   dimension, built_at, status

  **knowledge_chunk**              id, generation_id, source_id, ordinal, text,
                                   acl_json, pii_mask_json, vector_ref

  **graph_entity**                 id, generation_id, canonical_name, type, summary,
                                   community_id, degree

  **graph_edge**                   id, generation_id, src_entity_id, dst_entity_id,
                                   relation, weight, provenance_chunk_id

  **graph_community**              id, generation_id, level, parent_id, title,
                                   summary, entity_count

  **retrieval_event**              id, conversation_id, agent_version_id, strategy,
                                   hops, chunk_ids, citation_ids, latency_ms,
                                   cost_usd, grounded
  ------------------------------------------------------------------------------------

**8. Module C --- Skills and the Agent Design Studio**

**8.1 Skills as the unit of composition**

Version authoring today offers Text mode, a raw YAML editor for the full
definition, and Design mode, the same content as a structured form, with
each mode re-derived from the other so the YAML underneath is always
what is validated and saved. That is a good design and it is not the
problem. The problem is that there is no reusable unit below a whole
agent, so every version is authored from scratch and its eval cases are
written separately from the behaviour they test.

A skill is a named, versioned bundle of one capability: what triggers
it, the tools and knowledge it needs, the instruction fragment that
governs it, what success looks like, when to escalate, and the eval
cases that prove it works.

+-----------------------------------------------------------------------+
| kind: skill                                                           |
|                                                                       |
| name: refund_request                                                  |
|                                                                       |
| version: 3                                                            |
|                                                                       |
| trigger: \"customer asks to reverse a completed payment\"             |
|                                                                       |
| scope:                                                                |
|                                                                       |
| capabilityGroups: \[billing\]                                         |
|                                                                       |
| tools: \[payment.refund@billing_core, invoice.get@billing_core\]      |
|                                                                       |
| knowledge: \[billing_policy\]                                         |
|                                                                       |
| instructions: \|                                                      |
|                                                                       |
| Confirm the invoice and the amount before refunding. Never refund     |
|                                                                       |
| more than the original charge. State the expected settlement time.    |
|                                                                       |
| successCriteria: \"refund issued, or a stated reason why not\"        |
|                                                                       |
| escalateWhen:                                                         |
|                                                                       |
| \- \"amount \> 500\"                                                  |
|                                                                       |
| \- \"customer disputes a second time\"                                |
|                                                                       |
| evalCases: \[ec_refund_happy, ec_refund_partial, ec_refund_refuse,    |
| ec_refund_escalate\]                                                  |
+-----------------------------------------------------------------------+

Three things follow immediately. Eval suites stop being a separate
authoring chore, because composing five skills proposes five happy paths
and five refusal cases. Tool scope becomes reviewable per capability
rather than as one flat allow-list for a whole agent. And a where-used
view makes the blast radius of a change visible before it is made.

![](./media/893f566176f0b53734f8ffd3d33bdd2d2c6a23ed.png){width="6.25in"
height="3.0104166666666665in"}

*Figure 6 --- Skills library with a where-used panel. Consumers stay
pinned to the skill version they were composed with.*

+-----------------------------------------------------------------------+
| **Pinning is what protects immutability**                             |
|                                                                       |
| An agent version stores refund_request@3, never refund_request.       |
|                                                                       |
| Editing a skill creates version 4 and leaves every existing agent     |
| version untouched.                                                    |
|                                                                       |
| The skill detail page offers an \"upgrade consumers\" action that     |
| generates new draft agent versions for each consumer, every one of    |
| which goes through the promotion gate normally.                       |
|                                                                       |
| Without this rule, editing a shared skill silently changes the        |
| behaviour of agents already approved and running in production.       |
+-----------------------------------------------------------------------+

**8.2 The Agent Design Studio**

The Studio is a third authoring mode alongside Text and Design, not a
replacement for either. It must emit the same YAML, be validated by the
same validator, and save the same immutable version. If the Studio can
produce anything the schema cannot express, the architecture has been
broken.

  ------------------------------------------------------------------------
  **Step**        **Produces**                     **Reuses**
  --------------- -------------------------------- -----------------------
  **Purpose and   Name, role, tone, languages,     ---
  persona**       explicit out-of-scope statements 

  **Audience and  Declared trust level for this    Feeds the PII
  channel**       agent                            masking-context matrix

  **Skills**      Composed skill list, pinned by   Skills library
                  version                          

  **Tools**       Capability groups and explicit   The existing simulate
                  allow/deny rules                 preview from the tool
                                                   permissions screen

  **Knowledge**   Collection scopes, retrieval     Module B
                  strategy, grounding policy       

  **Guardrails    Thresholds, escalation triggers, Tenant PII and
  and             output policy                    Guardrails settings
  escalation**                                     

  **Model and     Model routes and cost/latency    Model Gateway v2 routes
  budgets**       ceilings                         

  **Memory**      Memory strategy and retention    ---
                  window                           

  **Evals**       A suite generated from the       Eval suites
                  composed skills, editable        

  **Review**      Full YAML preview, then a Draft  The same validator as
                  version                          Text and Design mode
  ------------------------------------------------------------------------

![](./media/8ba94cc3ecb03b7648b577ed4871dedc032b8916.png){width="6.25in"
height="2.8645833333333335in"}

*Figure 7 --- Agent Design Studio, skills step. The derived scope panel
shows what the composition actually grants, and the YAML preview shows
what will be saved.*

**8.3 Two invariants the Studio must not break**

- Tenant guardrails may be tightened by an agent version and never
  loosened. A version that relaxes tenant PII masking is rejected by the
  validator, not merely disabled in the interface.

- The Studio always lands in Draft. It never bypasses the eval,
  reviewer-not-author and sandbox gates. A wizard that produces
  production agents is how an unreviewed agent ends up talking to
  customers.

A blueprints gallery should sit alongside the Studio: pre-composed skill
sets for common shapes such as support triage, order status and IT
helpdesk, so a new tenant reaches a working Draft in minutes rather than
authoring YAML cold.

**8.4 Closing the eval gap**

Eval suites today are hand-authored scripted mini-conversations with an
expected-response pattern, a pass threshold and a cost budget, run to
gate promotion. Four additions make them a quality system rather than a
checkpoint.

  -----------------------------------------------------------------------
  **Addition**      **Why**
  ----------------- -----------------------------------------------------
  **Harvest from    A conversation, an escalation or a denied Tier-3
  production**      approval can be promoted into an eval case in one
                    action. The highest-value eval source in the platform
                    is already sitting in the Conversations list.

  **Continuous runs Model routes point at external providers whose
  against           behaviour changes. A version that passed in March is
  production**      not guaranteed to pass in August. Scheduled runs on
                    the deployed version catch provider drift.

  **Rubric and      Expected-response pattern matching is brittle for
  judge grading**   generative output. A judge model scored against a
                    rubric, plus groundedness and citation-precision
                    metrics for retrieval agents, measures what actually
                    matters.

  **Regression      Gate on \"no worse than the currently deployed
  baselines**       version\" rather than only on an absolute threshold,
                    so a slow decline cannot pass repeatedly.
  -----------------------------------------------------------------------

**8.5 Diff and Git**

Version comparison currently requires both versions to have a real Git
commit, because it is a genuine Git-provider diff API call. But versions
can be authored without ever connecting Git, so the majority path has no
diff capability at all on a platform whose core artifact is a YAML
document. The fix is to implement a structural YAML diff that works
unconditionally and keep the Git diff as the enriched view when a
repository is connected. This becomes more urgent, not less, once skills
and workflow graphs are also YAML artifacts.

The one-Git-connection-per-tenant constraint should also be relaxed to
one connection per definition or per team, since a large tenant with
separate engineering groups cannot share a single repository across all
agent definitions.

**9. Module D --- Workflow Designer**

**9.1 Static orchestration versus dynamic delegation**

Two mechanisms are needed and they must not be conflated, because they
require different governance. Static orchestration means the path is
authored, reviewable and diffable before deployment: a human can look at
the graph and know every route the system can take. Dynamic delegation,
covered in §10, means a supervisor decides at runtime which specialist
handles a turn --- strictly more capable and strictly less predictable.

Because the platform\'s entire posture rests on reviewability, the rule
is: use static orchestration whenever the process is knowable, and
constrain dynamic delegation with declarative policy that is itself
reviewable even though the path is not.

**9.2 Node types**

  -------------------------------------------------------------------------------
  **Node**           **Purpose**                    **Notes**
  ------------------ ------------------------------ -----------------------------
  **Trigger**        Channel event, inbound webhook A workflow may be bound to a
                     or schedule                    channel exactly as an agent
                                                    version is today

  **Agent**          Invoke a pinned                The agent runs with its own
                     definition@version             scope, intersected with the
                                                    workflow\'s

  **Skill**          Invoke a single skill without  Cheaper than a full agent
                     a whole agent                  turn for narrow tasks

  **Tool call**      A deterministic MCP call with  Faster, cheaper and fully
                     no model in the loop           auditable --- the right
                                                    choice for \"look up the
                                                    order\"

  **Router**         Rule-based or classifier-based Rules are preferred where the
                     branch                         condition is expressible

  **Human task**     Route into the existing        Never a third queue
                     Approval Queue or Escalation   
                     Queue                          

  **Parallel /       Fan out and reduce             Fan-out is capped by the run
  join**                                            limits

  **Loop**           Bounded iteration              A hard maximum-iteration cap
                                                    is mandatory, not optional

  **Sub-workflow**   Invoke another workflow        Depth-capped
                     version                        

  **Wait**           Timer or external event        Requires durable execution

  **End**            Resolve, escalate or transfer  Terminal outcomes are
                                                    explicit, never implicit
  -------------------------------------------------------------------------------

![](./media/c154179377192713534aed5ce71d3f41098601d1.png){width="6.25in"
height="2.8541666666666665in"}

*Figure 8 --- Workflow canvas. The graph is a rendering of the version
YAML; run limits are enforced by the runtime, not by the model.*

**9.3 Rules**

+-----------------------------------------------------------------------+
| **Orchestration must not become a way around the existing controls**  |
|                                                                       |
| The graph is YAML. The canvas is a renderer, so workflows inherit     |
| immutability, diffability and the promotion gate for free.            |
|                                                                       |
| The promotion gate applies unchanged: a passing eval run, an approver |
| who is not the author, and at least one sandbox run of the whole      |
| graph --- not of individual nodes.                                    |
|                                                                       |
| Tool tiering survives orchestration. A Tier-3 tool invoked from       |
| inside any node still stops at the Approval Queue. This is the most   |
| likely way to accidentally undermine an existing control.             |
|                                                                       |
| Every write-classified tool node declares an idempotency key and a    |
| compensating action, or the workflow is a distributed transaction     |
| with no rollback.                                                     |
+-----------------------------------------------------------------------+

- Durable execution is required. A workflow suspended on a human task
  may sit for hours, so state must be checkpointed, resumable after a
  restart, and subject to a defined expiry behaviour.

- Run-level budgets --- maximum steps, cost, wall-clock and loop
  iterations --- are enforced by the executor.

- Runtime Traces render the executed path over the graph rather than as
  a flat list, and a separate trace viewer is not built.

**9.4 Data model additions**

  ---------------------------------------------------------------------------
  **Entity**              **Key fields**
  ----------------------- ---------------------------------------------------
  **workflow**            id, tenant_id, name, description, status

  **workflow_version**    id, workflow_id, version, yaml, graph_json, status,
                          created_by, approved_by, eval_run_id,
                          sandbox_run_id

  **workflow_run**        id, workflow_version_id, conversation_id, state,
                          checkpoint_json, started_at, ended_at, cost_usd,
                          outcome

  **workflow_run_step**   id, run_id, node_id, node_kind, ref_version,
                          started_at, ended_at, status, cost_usd,
                          trace_span_id
  ---------------------------------------------------------------------------

**10. Module E --- Multi-agent orchestration**

**10.1 The central design move: agent as tool**

The temptation is to build a second invocation path for delegation. The
better decision is to register a specialist agent version as an entry in
the Tool Catalog, with its own read/write classification and approval
tier, exactly like an MCP tool.

That single decision buys almost everything. Delegation flows through
the existing per-tool permission rules with their simulate preview. A
specialist can be classified Tier 3, so a proposed hand-off lands in the
Approval Queue with no new interface. The agent_tool_config module
already controls whether a tool is visible to agents and its priority
weight when several could serve the same request, which is precisely the
routing-preference control a supervisor needs. And Runtime Traces
already record tool calls with arguments and results, so a delegation is
a trace entry by construction.

The alternative means duplicating tiering, permissions, audit and trace
rendering, and those duplicates will drift apart.

**10.2 Supported topologies**

  ------------------------------------------------------------------------
  **Pattern**     **When to use**            **Governance note**
  --------------- -------------------------- -----------------------------
  **Supervisor    Triage into scoped domains The default. The supervisor
  and                                        holds no tools of its own,
  specialists**                              only the ability to delegate

  **Sequential    Draft, then verify, then   Belongs in the workflow
  pipeline**      format                     graph, not in dynamic
                                             delegation

  **Parallel      Query several systems and  Hard fan-out cap and a shared
  fan-out and     merge                      run budget
  reduce**                                   

  **Critic or     A second agent checks the  Cheap, high value, and pairs
  verifier**      first agent\'s output      directly with the missing
                                             output-guardrail control

  **Peer          Full transfer of the       Permitted only where the
  hand-off**      conversation               receiving agent\'s scope is a
                                             subset of the sender\'s
  ------------------------------------------------------------------------

Free-form agent-to-agent messaging with no declared topology is
explicitly not supported. It cannot be reviewed, cannot be capped, and
produces an audit graph nobody can read.

**10.3 Team definition**

+-----------------------------------------------------------------------+
| kind: team                                                            |
|                                                                       |
| name: support_team                                                    |
|                                                                       |
| version: 3                                                            |
|                                                                       |
| supervisor:                                                           |
|                                                                       |
| definition: triage@14                                                 |
|                                                                       |
| modelRoute: chat.router \# routing is classification --- do not spend |
| a frontier model on it                                                |
|                                                                       |
| members:                                                              |
|                                                                       |
| \- definition: billing_agent@9                                        |
|                                                                       |
| delegationTier: 2                                                     |
|                                                                       |
| invokeWhen: \"billing, invoices, refunds, duplicate charges\"         |
|                                                                       |
| \- definition: orders_agent@5                                         |
|                                                                       |
| delegationTier: 1                                                     |
|                                                                       |
| \- definition: policy_agent@4                                         |
|                                                                       |
| delegationTier: 1                                                     |
|                                                                       |
| limits:                                                               |
|                                                                       |
| maxDepth: 2                                                           |
|                                                                       |
| maxFanOut: 3                                                          |
|                                                                       |
| maxDelegations: 6                                                     |
|                                                                       |
| runBudget: { usd: 0.40, seconds: 45 }                                 |
|                                                                       |
| failureMode: escalate \# never silently degrade                       |
+-----------------------------------------------------------------------+

![](./media/dde9934710a3cba6a763cf42da78e7893004b177.png){width="6.25in"
height="3.1875in"}

*Figure 9 --- Team definition with a routing simulator. Delegation
preview shows depth, cost and the highest tier the route would reach
before anything runs.*

**10.4 Six invariants the runtime must enforce**

  -----------------------------------------------------------------------------
  **\#**   **Invariant**                  **Why it matters**
  -------- ------------------------------ -------------------------------------
  1        Permissions compose by         Without this, a low-privilege
           intersection, never union.     supervisor delegating to a
           Effective scope equals member  high-privilege specialist is a
           scope intersected with         privilege-escalation primitive.
           supervisor scope intersected   
           with tenant policy.            

  2        Tier 3 survives every hop, and An approver looking at \"refund
           the Approval Queue displays    2,400\" with no idea which agent
           the delegation chain that      asked, on whose behalf, cannot make a
           produced the request.          real decision --- and this is the
                                          only human checkpoint.

  3        The PII masking-context matrix A hand-off is a context change. A
           is re-evaluated at every agent supervisor holding unmasked PII
           boundary.                      passing a full transcript to a
                                          lower-trust specialist bypasses
                                          masking by composition.

  4        One conversation raises one    Two specialists tripping an
           escalation, against the        escalation condition must not put the
           parent, with the chain         customer into two queues, and the
           attached.                      takeover panel must show the whole
                                          tree.

  5        Budgets are shared and         A supervisor that can re-delegate on
           enforced at run level: depth,  failure is an unbounded loop unless
           fan-out, delegation count,     the executor stops it.
           cumulative cost and            
           wall-clock.                    

  6        Members are pinned by version. Promoting a member to a new version
                                          must not silently change a production
                                          team\'s behaviour after it was
                                          reviewed.
  -----------------------------------------------------------------------------

**10.5 Extending the existing surfaces**

  --------------------------------------------------------------------------
  **Surface**       **Change required**
  ----------------- --------------------------------------------------------
  **Runtime         Becomes a tree: which agent handled which span, the
  Traces**          delegation reason, per-agent token and cost attribution,
                    and the run total. Without it, a wrong answer in a
                    three-agent run cannot be traced to the hop that
                    produced it.

  **Conversations   Agent attribution on the transcript, with the reasoning
  detail**          trace collapsible per agent, so it is clear which agent
                    produced each customer-visible message.

  **Audit Log**     Actor attribution becomes a chain --- \"billing_agent@9,
                    delegated by triage@14, on conversation 4471\" ---
                    rather than a bare agent name.

  **Approval        A delegation-chain panel and the policy context that
  Queue**           caused the stop: tool tier, the guardrail that fired,
                    the skill in play and the pinned manifest version.

  **Dashboard**     Delegation metrics: routing accuracy, depth
                    distribution, cost per resolved conversation and
                    per-member escalation rate.

  **Evals**         Two new case types --- routing cases tested against the
                    supervisor alone, and end-to-end team cases with an
                    expected outcome and a budget ceiling. Routing
                    regressions are the commonest multi-agent failure and
                    the easiest to catch mechanically.

  **Sandbox**       Runs the whole team in isolation with a visible
                    delegation tree, since the promotion gate requires a
                    completed sandbox conversation and a supervisor-only
                    sandbox proves nothing.
  --------------------------------------------------------------------------

![](./media/0884208cc3ca98b017ed291a3f57c6bef0d08c6c.png){width="6.25in"
height="2.78125in"}

*Figure 10 --- Runtime trace as a tree, with per-agent model, token,
cost and outcome attribution across a delegated run including an
approval pause and resume.*

![](./media/40de20751041a9f610d1706a4d49ca83182817f7.png){width="6.25in"
height="2.9583333333333335in"}

*Figure 11 --- Approval Queue with the delegation chain, arguments
including an idempotency key, and the policy context that caused the
stop.*

**10.6 Failure modes to design for**

  -----------------------------------------------------------------------
  **Failure**             **Mitigation**
  ----------------------- -----------------------------------------------
  **Routing thrash ---    Detect repeated delegation to the same member
  the supervisor bounces  with a similar payload; cap and escalate
  between two             
  specialists**           

  **Context loss on       Pass structured state through a
  hand-off --- the        conversation-scoped blackboard rather than a
  specialist receives a   re-summarised transcript
  summary that dropped    
  the customer\'s actual  
  constraint**            

  **Specialist            Declare a per-member fallback: another member,
  unavailable --- its     or escalate. Never silently answer without the
  pinned version was      specialist
  deprecated or its       
  connector is offline**  

  **Confidently wrong     Specialists need an explicit \"not mine\"
  routing --- a           return path, treated as a first-class outcome
  specialist without the  in traces rather than as an error
  right tools             
  improvises**            

  **Injection propagation Run output guardrails on tool results before
  --- attacker-controlled they cross a delegation boundary, not only
  tool output crosses an  before they reach the customer
  agent boundary and      
  inherits the receiving  
  agent\'s trust**        
  -----------------------------------------------------------------------

**10.7 Data model additions**

  --------------------------------------------------------------------------
  **Entity**             **Key fields**
  ---------------------- ---------------------------------------------------
  **team**               id, tenant_id, name, description, status

  **team_version**       id, team_id, version,
                         supervisor_definition_version_id, limits_json,
                         failure_mode, yaml, status, approved_by

  **team_member**        id, team_version_id, definition_version_id,
                         delegation_tier, invoke_when, fallback_member_id

  **delegation_event**   id, conversation_id, run_id, parent_span_id,
                         from_agent_version_id, to_agent_version_id, reason,
                         depth, cost_usd, outcome
  --------------------------------------------------------------------------

**11. Module F --- Model Gateway v2**

**11.1 Why the current design does not hold**

The Model Gateway today has two tabs. Routes are the named targets an
agent\'s modelRoute field points at, each a chain of one or more
providers --- either a platform-registered provider or a bring-your-own
endpoint with its own credential --- plus cache mode and timeout
settings. Provider Registry is a read-only list of the platform-level
providers available to route to. Model names typed into a route are
lightly validated to catch obvious paste errors.

The shape is right; the abstraction is one layer short. A model is not a
string. It has a context window, a maximum output, a price per million
tokens in and out, a modality, a tokenizer family, a deprecation date,
and a set of capabilities --- tool calling, vision, streaming,
structured output, extended thinking --- that determine whether an agent
version can even run on it. Because none of that is modelled, the
platform cannot answer basic questions: whether a route can serve an
agent that needs tool calling, what a conversation cost, which routes
break when a provider retires a model, or whether a fallback hop would
send data out of the tenant\'s region.

**11.2 The three-layer model**

  ----------------------------------------------------------------------------
  **Layer**      **Object**              **Owns**
  -------------- ----------------------- -------------------------------------
  **Provider**   A connection to a       Provider type and adapter, base URL,
                 model-serving endpoint  authentication and vaulted
                                         credential, region, data-retention
                                         and training flags, organisation or
                                         project identifier, network
                                         reachability and egress policy, rate
                                         limits, health

  **Model**      A catalogue entry       Model identifier, display name,
                 belonging to a provider modality, context window, maximum
                                         output, capability flags, tokenizer
                                         family, price in and out, cached
                                         price, latency profile, status and
                                         deprecation date

  **Route**      A named logical         An ordered chain of targets, each a
                 endpoint agents         provider plus model plus parameters,
                 reference               with failover conditions, retry and
                                         timeout, cache mode, weights, cost
                                         ceiling and residency constraints
  ----------------------------------------------------------------------------

**11.3 Provider types**

Provider type drives the adapter, not just the label. One
openai-compatible type covers vLLM, TGI, LiteLLM and most self-hosted
gateways, since they share a wire format and differ only in endpoint and
authentication.

  ------------------------------------------------------------------------------------
  **Provider type**       **Covers**                  **Auth**       **Catalogue
                                                                     sync**
  ----------------------- --------------------------- -------------- -----------------
  **anthropic**           Anthropic API               API key        Static list plus
                                                                     API

  **openai**              OpenAI API                  API key        GET /v1/models

  **azure-openai**        Azure OpenAI Service,       API key or     Deployment list
                          regional deployments        Entra ID       

  **google-vertex**       Vertex AI and AI Studio     Service        Publisher model
                                                      account or API list
                                                      key            

  **bedrock**             AWS Bedrock                 IAM role or    Foundation model
                                                      keys           list

  **openrouter**          OpenRouter as a             API key        GET
                          meta-provider across many                  /api/v1/models,
                          vendors                                    then a tenant
                                                                     allowlist

  **openai-compatible**   vLLM, TGI, LiteLLM, and any None, API key  GET /v1/models
                          OpenAI-shaped endpoint      or mTLS        

  **ollama**              Local or on-premise Ollama  None           GET /api/tags

  **cohere / mistral /    Direct vendor APIs          API key        Vendor list or
  custom**                                                           manual
                                                                     declaration
  ------------------------------------------------------------------------------------

![](./media/d5260e20d7a6efd64cd447f06da5cc4b3704696f.png){width="6.25in"
height="2.6666666666666665in"}

*Figure 12 --- Provider registry. Region and the provider\'s
data-retention flag are checked against Settings \> Retention and
Residency before a route may use it.*

**11.4 The model catalogue**

The catalogue replaces the free-text model name entirely. A route
selects a catalogue entry; it never stores a typed string. Entries are
synced from the provider where an API exists and declared manually for
self-hosted deployments, and every entry carries the metadata that makes
validation and cost reporting possible.

![](./media/4b81d926dd9e3d1c15a94e33d0f7855c9bf69ae2.png){width="6.25in"
height="3.1354166666666665in"}

*Figure 13 --- Model catalogue across providers, including self-hosted
vLLM and Ollama entries and an embedding and a rerank model.*

+-----------------------------------------------------------------------+
| **Capability validation happens at save time, not at runtime**        |
|                                                                       |
| If an agent version declares tool use and the primary model on its    |
| route does not support tool calling, the version fails validation     |
| before it can be saved.                                               |
|                                                                       |
| A route advertises only the capabilities that every hop in its chain  |
| supports --- the weakest hop wins, because a fallback that silently   |
| drops tool calling is worse than a failure.                           |
|                                                                       |
| A model marked as deprecating raises a warning on every route and     |
| every agent version that pins it, with the provider\'s end-of-life    |
| date.                                                                 |
+-----------------------------------------------------------------------+

**11.5 Routes**

Routes remain the abstraction agents point at, and gain the policy that
makes a fallback chain safe rather than merely present.

+-----------------------------------------------------------------------+
| kind: modelRoute                                                      |
|                                                                       |
| name: chat.primary                                                    |
|                                                                       |
| version: 7                                                            |
|                                                                       |
| chain:                                                                |
|                                                                       |
| \- provider: anthropic \# 1 --- primary                               |
|                                                                       |
| model: claude-sonnet-4-6                                              |
|                                                                       |
| params: { temperature: 0.2, maxTokens: 4096 }                         |
|                                                                       |
| cache: ephemeral                                                      |
|                                                                       |
| \- provider: azure-openai \# 2 --- fallback, same region as the       |
| tenant                                                                |
|                                                                       |
| model: gpt-4.1                                                        |
|                                                                       |
| failoverOn: \[429, 5xx, timeout\]                                     |
|                                                                       |
| \- provider: vllm-internal \# 3 --- last resort, self-hosted          |
|                                                                       |
| model: qwen3-32b-instruct                                             |
|                                                                       |
| setsDegradedFlag: true                                                |
|                                                                       |
| policy:                                                               |
|                                                                       |
| allowOutOfRegionFailover: false                                       |
|                                                                       |
| timeout: { perHop: 20s, total: 45s }                                  |
|                                                                       |
| retry: { attempts: 2, backoff: exponential }                          |
|                                                                       |
| costCeilingPerTurn: 0.05                                              |
|                                                                       |
| logPromptsToTraces: masked                                            |
+-----------------------------------------------------------------------+

- Recommended standard routes: chat.primary for answering, chat.router
  for classification and routing, embed.default for the knowledge index,
  rerank.default for retrieval reranking, and vision.default where
  images are handled.

- Routing on a cheap model and answering on a strong one is the single
  largest cost lever in a multi-agent system, and it is only expressible
  once routes are per-role rather than per-agent.

- Routes are versioned. An agent version pins route@version, so editing
  a route does not change the behaviour of an already-promoted agent.

- Failover semantics are declared, not implied: which error classes
  advance to the next hop, and whether a hop in another region is
  permitted at all. The default is that it is not.

![](./media/a4ab2c86d7fee09ee9bab307c77dbdf43096f7fd.png){width="6.25in"
height="2.9375in"}

*Figure 14 --- Route editor with the fallback chain, policy, the
capability intersection the route can guarantee, and live cost.*

**11.6 Usage, cost and the tenant view**

Once providers, models and routes are modelled, usage telemetry becomes
straightforward and closes gap G-11 directly. A usage tab should report
spend and volume by provider, model, route, agent version and channel,
with a cost-per-resolved-conversation figure that is the number a tenant
actually cares about. Budget breach behaviour is declared at the route
level --- degrade to a cheaper hop, or fail --- rather than being
discovered when a limit is hit.

**11.7 Governance and residency**

  -----------------------------------------------------------------------
  **Control**      **Rule**
  ---------------- ------------------------------------------------------
  **Plan-tier      The Platform Manager console governs which provider
  restriction**    types a plan tier may use, so a Starter tenant cannot
                   attach an arbitrary bring-your-own endpoint if policy
                   forbids it

  **Residency      A provider\'s region is checked against the tenant\'s
  enforcement**    storage region and out-of-region inference setting. A
                   route whose chain would breach it cannot be saved

  **Data handling  Each provider records whether prompts are retained and
  flags**          whether they may be used for training. Routes surface
                   the strictest flag in their chain

  **Credential     Provider credentials use the same encrypted vault as
  handling**       connectors and are never returned in plaintext

  **Self-hosted    vLLM and Ollama providers need no credential but do
  reachability**   need a reachability check, a concurrency limit and a
                   health probe, since an unreachable local endpoint is a
                   silent outage

  **Embedding      A knowledge index generation records the exact
  model pinning**  embedding provider and model. Changing it invalidates
                   the index rather than silently mixing vector spaces
  -----------------------------------------------------------------------

**11.8 Data model additions**

  -----------------------------------------------------------------------------
  **Entity**                **Key fields**
  ------------------------- ---------------------------------------------------
  **model_provider**        id, tenant_id (null for platform), type, name,
                            base_url, region, auth_method, credential_ref,
                            retains_prompts, trains_on_data, rate_limit_json,
                            status

  **model_catalog_entry**   id, provider_id, model_id, display_name, modality,
                            context_window, max_output, capabilities_json,
                            tokenizer, price_in, price_out, price_cached,
                            status, deprecates_at

  **model_route**           id, tenant_id, name, description

  **model_route_version**   id, route_id, version, chain_json, policy_json,
                            created_by, status

  **model_usage_event**     id, tenant_id, route_version_id, catalog_entry_id,
                            agent_version_id, conversation_id, tokens_in,
                            tokens_out, cached_tokens, cost_usd, latency_ms,
                            hop_index, outcome
  -----------------------------------------------------------------------------

**12. Cross-cutting concerns**

**12.1 Permission composition**

Every new module introduces a way for one artifact to reference another,
and each reference is a place where scope could widen. The rule stated
in §5.3 is repeated here because it must be implemented once, centrally,
in the authorisation layer rather than separately in each module:
effective scope is the intersection of the caller, the artifact and
tenant policy. A workflow node, a delegated agent, a composed skill and
a retrieval call all pass through the same evaluator.

**12.2 Guardrails on the way out, not only on the way in**

PII detection, the masking-context matrix and pre-tool-call blocking all
act before something happens. Nothing acts on what comes back. Three
additions are needed, and they become more urgent once tool output and
retrieved content cross agent boundaries.

  -----------------------------------------------------------------------------
  **Guardrail**        **Applies to**              **Why**
  -------------------- --------------------------- ----------------------------
  **Prompt-injection   Inbound customer messages   A Fetch-class connector
  detection**          and, critically, tool       returns attacker-controlled
                       results and retrieved       text into model context.
                       chunks                      This is exploitable today
                                                   and propagates across agents
                                                   once delegation exists

  **Output policy**    Agent responses before they Toxicity, off-topic drift,
                       reach the customer or cross and disclosure of masked
                       a delegation boundary       entities

  **Groundedness       Responses from any agent    Enforces
  check**              with a knowledge scope      refuseWhenUngrounded rather
                                                   than trusting the model to
                                                   abstain
  -----------------------------------------------------------------------------

**12.3 Rollback**

This is the highest risk-to-effort item in the entire document.
Promotion replaces the prior production deployment, and the only
recovery path is Restore, which authors a new version that must then
pass the full gate. The platform can deploy faster than it can recover.

+-----------------------------------------------------------------------+
| **Emergency rollback**                                                |
|                                                                       |
| Re-promote a previously-Production version directly, bypassing the    |
| gate on the grounds that it already passed the gate when it was first |
| promoted.                                                             |
|                                                                       |
| Require a stated reason, write it to the audit log, and notify the    |
| tenant\'s administrators.                                             |
|                                                                       |
| This is not a weakening of the promotion gate. It is a recognition    |
| that the gate has already been satisfied for that exact artifact,     |
| which is only true because versions are immutable.                    |
+-----------------------------------------------------------------------+

Progressive rollout follows once rollback exists: traffic splitting on
the channel-to-version binding, and shadow evaluation of a candidate
version against live traffic without customer exposure.

**12.4 Observability, export and recoverability**

- OpenTelemetry export of traces and metrics, so a tenant can see
  NextBot spans alongside their own systems.

- Audit log streaming to a SIEM, which enterprise security teams will
  require and which cannot be retrofitted onto a console-only log.

- A consented break-glass path for platform operators. The cross-tenant
  health rollup is deliberately metadata-only, which is correct, but it
  leaves no way to diagnose a tenant-specific quality regression without
  the tenant\'s cooperation. Make that cooperation explicit, time-boxed
  and audited on both sides rather than absent.

- Configuration export and restore for a tenant\'s agents, skills,
  workflows, teams, connectors, routes and policies. Retention and
  Residency covers purge and region, not recoverability.

**12.5 Escalation, workforce and channels**

Escalation routing maps a goal and channel combination to a queue, and
the detail page is a live takeover panel. Everything between \"it landed
in a queue\" and \"a human is holding it\" is missing: assignment and
claiming, SLA timers and aging, agent availability and presence,
concurrency limits, and CSAT capture at the end of a takeover --- which
is also the natural feedback loop into evals. Routing to a queue nobody
is watching is silent failure, and that is the current default.

On channels: two types exist, Web Widget and WhatsApp Business. The
adjacent set --- email, SMS, voice, Instagram and Messenger, Slack and
Teams for internal use --- needs a generalised channel abstraction so
that adding a type is configuration rather than engineering.
Cross-channel identity resolution matters more: the same customer on
WhatsApp and on the web is currently two unrelated conversations with no
shared context.

**12.6 Identity and the developer surface**

  -----------------------------------------------------------------------
  **Gap**          **Requirement**
  ---------------- ------------------------------------------------------
  **SSO and SCIM** SAML and OIDC single sign-on, and SCIM provisioning.
                   On a platform with an Enterprise tier, residency
                   controls and a DSR screen, password plus TOTP is a
                   procurement blocker independent of product quality

  **Session and    Session listing and revocation, service accounts and
  key management** scoped API keys, and per-tenant password and MFA
                   enforcement policy

  **Public API**   Everything is console-driven today. Agent versions,
                   skills, workflows and knowledge sources should be
                   manageable programmatically

  **Webhooks**     Outbound events for escalation created, approval
                   pending, guardrail tripped, deployment changed and
                   drift detected, so tenant systems can react
  -----------------------------------------------------------------------

**13. Delivery roadmap**

Sequencing is driven by dependency and by risk, not by visible feature
value. Three items in Phase 0 are small and prevent incidents that are
currently unrecoverable.

  --------------------------------------------------------------------------------
  **Phase**   **Item**               **Rationale**                  **Depends on**
  ----------- ---------------------- ------------------------------ --------------
  **0**       Emergency rollback     The platform can deploy faster ---
                                     than it can recover. Highest   
                                     risk-to-effort ratio in the    
                                     document                       

  **0**       Capability-group       Already referenced by the      ---
              management screen      Design mode picker and         
                                     unauthorable anywhere          

  **0**       Manifest pinning and   Closes the clearest            ---
              drift quarantine       privilege-escalation path in   
                                     the platform                   

  **0**       Injection guardrail on Exploitable today through the  ---
              tool results           Fetch connector                

  **0**       Structural YAML diff   The majority authoring path    ---
              without Git            has no diff at all             

  **1**       Model Gateway v2 ---   Prerequisite for knowledge     Phase 0
              providers, catalogue,  indexing and for per-role      
              routes, usage          routing in teams               

  **1**       MCP enrolment wizard   Governs the tool supply chain  Manifest
              and registry           the rest of the platform       pinning
                                     composes over                  

  **1**       Skills library with    The unit of composition        ---
              version pinning        everything above depends on    

  **1**       SSO and SCIM           Gates enterprise deals         ---
                                     regardless of the rest of the  
                                     roadmap                        

  **2**       Knowledge and Graph    The largest capability gap;    Model Gateway
              RAG, retrieval agent,  needs a pinned embedding model v2
              citations                                             

  **2**       Agent Design Studio    Composes skills; a wizard      Skills
              and blueprints         without skills is only a       
                                     longer form                    

  **2**       Permission             Must ship before any           ---
              intersection evaluator delegation runs in production, 
              and trace tree         not after                      

  **2**       Escalation SLA,        Escalations exist but are not  ---
              assignment, presence   operable at scale              
              and CSAT                                              

  **3**       Agent-as-tool          Mostly registration and policy Intersection
              registration and       over machinery that already    evaluator,
              supervisor teams       exists                         trace tree

  **3**       Workflow designer and  The heavier of the two         Skills, teams
              durable runtime        orchestration mechanisms       

  **3**       Eval harvesting, judge Compounding quality gains once Skills
              grading, continuous    composition exists             
              runs                                                  

  **4**       Progressive rollout,   Safe to build only once        Phase 0, trace
              shadow evaluation,     rollback and trace attribution tree
              canary                 exist                          

  **4**       Public API, webhooks,  Integration parity in both     Stable module
              OpenTelemetry and SIEM directions                     boundaries
              export                                                

  **4**       Channel expansion and  Straightforward once the       ---
              cross-channel identity channel abstraction is         
                                     generalised                    
  --------------------------------------------------------------------------------

+-----------------------------------------------------------------------+
| **Two ordering constraints that are not negotiable**                  |
|                                                                       |
| Model Gateway v2 ships before the knowledge subsystem. A knowledge    |
| index pins an embedding model and cannot pin a free-text string.      |
|                                                                       |
| The permission intersection evaluator and the trace tree ship before  |
| the first delegation runs in production. Retrofitting a permission    |
| model onto a live multi-agent system means auditing every existing    |
| team for escalation paths, and retrofitting attribution means the     |
| traces most needed for the first incident do not exist.               |
+-----------------------------------------------------------------------+

**14. Risks and open decisions**

**14.1 Risks**

  ----------------------------------------------------------------------------
  **Risk**          **Impact**                **Mitigation**
  ----------------- ------------------------- --------------------------------
  **Shared mutable  A promoted agent silently Version-pin every reference at
  artifacts break   changes behaviour after   compose time; provide an
  version           review, destroying the    explicit upgrade-consumers
  immutability**    platform\'s strongest     action that generates new drafts
                    guarantee                 

  **Orchestration   Tier-3 calls execute      Enforce tiering in the tool
  becomes a path    without human approval    executor, below the
  around tool       from inside a workflow    orchestration layer, and test it
  tiering**         node or a delegated agent as a promotion gate case

  **Graph           Retrieval degrades in     Ship the graph explorer with
  extraction        ways nobody can diagnose, provenance in the first release,
  quality is poor   and trust in the          plus retrieval evals measuring
  and invisible**   knowledge layer collapses groundedness and citation
                    early                     precision

  **Multi-agent     A supervisor plus three   Per-role routes with a cheap
  cost runs away**  specialists plus          router model, run-level budgets
                    retrieval can cost an     enforced by the executor, and
                    order of magnitude more   cost-per-resolved-conversation
                    per conversation than a   on the dashboard from day one
                    single agent              

  **The Studio      Authoring surfaces        One validator, and a test that
  outpaces the      diverge and the YAML      asserts every Studio output
  schema**          stops being the single    round-trips through Text mode
                    source of truth           unchanged

  **Provider        Models are retired by     Scheduled catalogue sync,
  catalogue drift** providers and routes fail deprecation warnings on every
                    in production             referencing route and agent
                                              version, and a declared fallback
                                              chain

  **Scope creep     Nothing reaches           Phase 0 is five small items that
  across six        production quality        stand alone; each later phase
  modules**                                   has a single load-bearing
                                              dependency and can ship
                                              independently
  ----------------------------------------------------------------------------

**14.2 Decisions required before build**

1.  Graph store: a dedicated graph database, or graph tables plus a
    vector index in the existing store. The second is simpler
    operationally and sufficient at the scale implied by the current
    tenant model; the first is easier if multi-hop traversal depth
    grows.

2.  Whether teams and workflows are two artifacts or one. This document
    proposes two, because their governance differs, but a single
    artifact with a mode flag is defensible and reduces surface area.

3.  Whether skills are tenant-scoped only, or whether a platform-level
    blueprint library is shared across tenants. Sharing creates a
    cross-tenant supply-chain question that the current isolation model
    does not have.

4.  Whether the knowledge subsystem indexes conversation history as a
    source. It is valuable and it interacts directly with retention, DSR
    deletion and the masking matrix.

5.  How far the Platform Manager console governs provider types per plan
    tier, given that bring-your-own endpoints are a stated capability
    today.

6.  Whether routing decisions in a team are recorded as a
    customer-visible event. They are useful in the takeover panel and
    they expose internal structure.

**Appendix A --- Wireframe index**

All wireframes are indicative layouts intended to fix information
architecture and the placement of controls, not visual design. They
deliberately reuse the existing console chrome, sidebar grouping and
read-only affordances described in the Screen Reference.

  --------------------------------------------------------------------------------------------------
  **Figure**   **Screen**                             **Section**   **File**
  ------------ -------------------------------------- ------------- --------------------------------
  **1**        MCP registry list                      ---           wf01-mcp-registry.png

  **2**        Enrolment wizard, discovery and        ---           wf02-mcp-enrolment.png
               classification step                                  

  **3**        Knowledge collections with the         ---           wf03-knowledge-collections.png
               ingestion pipeline for one collection                

  **4**        Graph explorer with an entity          ---           wf04-graph-explorer.png
               inspector                                            

  **5**        Retrieval playground comparing three   ---           wf05-retrieval-playground.png
               strategies on one query, with                        
               groundedness, latency and cost per                   
               strategy                                             

  **6**        Skills library with a where-used panel ---           wf09-skills-library.png

  **7**        Agent Design Studio, skills step       ---           wf10-studio-wizard.png

  **8**        Workflow canvas                        ---           wf11-workflow-canvas.png

  **9**        Team definition with a routing         ---           wf12-team-routing.png
               simulator                                            

  **10**       Runtime trace as a tree, with          ---           wf13-trace-tree.png
               per-agent model, token, cost and                     
               outcome attribution across a delegated               
               run including an approval pause and                  
               resume                                               

  **11**       Approval Queue with the delegation     ---           wf14-approval-delegation.png
               chain, arguments including an                        
               idempotency key, and the policy                      
               context that caused the stop                         

  **12**       Provider registry                      ---           wf06-model-providers.png

  **13**       Model catalogue across providers,      ---           wf07-model-catalog.png
               including self-hosted vLLM and Ollama                
               entries and an embedding and a rerank                
               model                                                

  **14**       Route editor with the fallback chain,  ---           wf08-route-editor.png
               policy, the capability intersection                  
               the route can guarantee, and live cost               
  --------------------------------------------------------------------------------------------------

**Appendix B --- Glossary**

  ---------------------------------------------------------------------------
  **Term**           **Definition**
  ------------------ --------------------------------------------------------
  **Agent            The named, versioned identity a channel talks to, with a
  definition**       history of versions underneath it

  **Agent version**  An immutable YAML document describing model route,
                     instructions, tool policy, guardrails, memory strategy,
                     eval suite and budgets

  **Capability       A named, curated set of tools drawn from one or more MCP
  group**            servers, selectable when scoping an agent version

  **Community**      A cluster of related entities in the knowledge graph,
                     summarised so that broad questions can be answered
                     without reading every chunk

  **Delegation       The ordered record of which agent invoked which, used
  chain**            for audit attribution and for approval context

  **Groundedness**   The proportion of an answer supported by retrieved
                     evidence; used as an eval metric and as a runtime
                     refusal condition

  **Manifest**       The hashed snapshot of the tools, resources and prompts
                     an MCP server exposed at the moment it was approved

  **Promotion gate** The three conditions required to reach Production: a
                     passing eval run, an approver who is not the author, and
                     a completed sandbox conversation

  **Route**          A named logical model endpoint, backed by an ordered
                     chain of provider-and-model targets with failover policy

  **Skill**          A versioned bundle of one capability: trigger, scope,
                     instructions, success criteria, escalation conditions
                     and eval cases

  **Team**           A supervisor agent plus scoped member agents, with
                     delegation limits and a failure mode

  **Tier 1 / 2 / 3** Tool approval tiers: executed automatically, executed
                     and logged, and held for human approval respectively

  **Workflow**       A versioned orchestration graph of triggers, agents,
                     tools, routers, human tasks and terminal outcomes
  ---------------------------------------------------------------------------
