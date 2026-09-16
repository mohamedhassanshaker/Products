[← Requirements index](./README.md)

# 5.17 `userguide` — in-product user guide (Phase F)

Mandatory in-product module, beyond the wireframe. The guide is part of the product, not an external document.

| ID | Requirement | Source | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-GUIDE-01 | The system shall present a persistent help control in the application header on every authenticated page, opening the user guide module. | Phase F | MUST | The control is present on all 14 backoffice screens plus the theming, guide and Pipeline Designer screens, is keyboard reachable, and opens the guide without losing the current page's state. |
| FR-GUIDE-02 | The guide shall present a side menu listing every module, submodule and page, mirroring the real application navigation. | Phase F | MUST | The guide menu structure is generated from the application's route and navigation definition, so a new page appears in the guide menu automatically rather than by hand-editing a list. |
| FR-GUIDE-03 | The system shall hold one guide entry per page in the application, and a page with no entry shall fail the release gate. | Phase F | MUST | A coverage check enumerates routes against guide entries and fails on any gap. Run against the 17 wireframe screens plus Settings → Appearance, the guide itself, and the Pipeline Designer's list and editor routes, coverage is 100%. |
| FR-GUIDE-04 | Each guide entry shall contain a current screenshot of the page, its purpose in plain language, a walkthrough of every feature, button, filter and field on it, step-by-step instructions for its main tasks written for a non-technical reader, and notes on the permissions and roles that change what the user sees. | Phase F | MUST | Each of the five elements is present in every entry, structurally rather than as free prose, so absence is detectable by a check. Entries for permission-sensitive screens name the specific permissions from B9 tab 3. |
| FR-GUIDE-05 | The guide shall be searchable across entry titles and body content, returning results ranked and scoped to what the user may access. | Phase F | MUST | Searching a term present in one entry returns that entry. A user without a permission does not receive results describing screens they cannot reach. |
| FR-GUIDE-06 | The guide shall be deep-linkable per entry, and the help control shall open the entry for the page the user is currently on. | Phase F | MUST | Each entry has a stable URL that opens directly. Opening help from the knowledge screen lands on the knowledge entry, not on the guide index. |
| FR-GUIDE-07 | The guide shall be available in English and Arabic, honouring the direction setting. | Phase F; B10 tab 5 | MUST | Both locales render, including screenshots appropriate to the locale's direction. Missing translations fall back per [`channels.md`](./channels.md) FR-CHAN-19 and are counted against translation completeness. |
| FR-GUIDE-08 | The guide shall be versioned with the application, so a user sees the guide matching the running release. | Phase F | MUST | The guide reports the application version. A deployed release never serves guide content authored against a different release. |
| FR-GUIDE-09 | The system shall regenerate guide screenshots as part of the release process and shall flag any entry whose screenshot predates its page's last change. | Phase F | MUST | Changing a page without regenerating its screenshot raises a staleness flag on that entry. Screenshots are produced by an automated capture against the seeded fixtures ([`platform.md`](./platform.md) FR-PLAT-10), not captured by hand. |
| FR-GUIDE-10 | The guide's role and permission notes shall be generated from the live permission matrix rather than transcribed. | Phase F; B9 tab 3 | SHOULD | Changing a matrix cell changes the affected entries' permission notes without a content edit. A transcribed note that contradicts the matrix is impossible. |

---
[← `theming`](./theming.md) · [Requirements index](./README.md) · [Next: cross-module invariants →](./cross-module.md)
