# NextBot — Bot Agents & Live Agent Wireframes

Interactive HTML wireframes for the **bot/agentic platform** and **live (human) agent** screens from [`NextBot_Screen_Inventory_v3.md`](../NextBot_Screen_Inventory_v3.md).

## Open

Open [`index.html`](./index.html) in a browser (file:// or any static server).

```bash
# optional local server from this folder
npx --yes serve .
```

## Screen index

### Bot — Agent Platform (B.15)

| ID | Screen | Priority |
|---|---|---|
| B.15.1 | Agent Definition Registry | Launch-critical |
| B.15.2 | Code-First Agent Builder | Post-launch |
| B.15.3 | Deployment & Canary Manager | Launch-critical |
| B.15.4 | Eval Suite Runner | Launch-critical |
| B.15.5 | Model Gateway Configuration | Launch-critical |
| B.15.6 | Agent Runtime Observability / Trace Explorer | Launch-critical |

### Bot — Conversation Designer (Portal C)

| ID | Screen | Priority |
|---|---|---|
| C.1.1 | Capability & Tool Catalog | Launch-critical |
| C.1.2 | Dialogue Flow Designer | Launch-critical |
| C.1.3 | Parameter Validation & Extraction Hints | Launch-critical |
| C.1.4 | Guardrail / Safety Rules Editor | Launch-critical |
| C.1.5 | Knowledge Base Config | Launch-critical |

### Live Agent — Escalation & Bridge (B.5 + Portal D)

| ID | Screen | Priority |
|---|---|---|
| B.5.1 | Escalation Queue | Launch-critical |
| B.5.2 | Live Agent Takeover Panel | Launch-critical |
| B.5.3 | Escalation Routing Config | Launch-critical |
| D.1.1 | My Escalation Queue | Launch-critical |
| D.1.2 | Live Conversation + Context Panel | Launch-critical |
| D.1.3 | Agent Performance Dashboard | Post-launch |

**Total:** 17 screens (15 launch-critical · 2 post-launch)

## Files

| Path | Role |
|---|---|
| `index.html` | App shell |
| `css/style.css` | Shared wireframe design system |
| `js/app.js` | Renderer / nav |
| `js/data-bot-platform.js` | B.15 screens |
| `js/data-bot-designer.js` | Portal C screens |
| `js/data-live-agent.js` | B.5 + Portal D screens |

Full platform inventory (widget, MCP, developer portal, etc.) remains in [`../nextbot-wireframes/`](../nextbot-wireframes/).
