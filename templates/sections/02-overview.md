## 1. Overview

This wiki documents the **as-built configuration** of IBM FlashSystem storage in scope for **{{customer.name}}**. It is generated from live discovery (REST API) into `config.yaml` / `inventory.yaml`, then rendered with the modular wiki builder.

| Metric | Value |
|--------|-------|
| Systems | **{{metrics.systems}}** |
| Hosts (objects) | **{{metrics.hosts}}** |
| Storage pools | **{{metrics.pools}}** |
| Volumes | **{{metrics.volumes}}** |
| Code level(s) | {{code_levels}} |
| Deployment class | **{{deployment_label}}** (`{{deployment}}`) |
| Flash Grid | {{grid.configured}} — {{grid.name}} |
| Partnership summary | {{partnership.summary}} |

### 1.1 How systems are related (auto-classified)

Discovery classifies the document from array data — it does **not** assume a Flash Grid just because multiple hosts were scanned.

| Class | Meaning |
|-------|---------|
| `standalone` | One system; no Flash Grid name on `lssystem` |
| `grid_member` | One system that **reports** a Flash Grid name (peers not in this scan) |
| `flash_grid` | **2+ systems share the same** Flash Grid name from the arrays |
| `partnership` | 2+ systems, **not** a shared grid, but `lspartnership` links them to each other |
| `multi_system` | 2+ systems documented together, **no** shared grid and **no** mutual partnership (e.g. prod + Veeam backup) |

**This discovery concluded:** {{deployment_reason}}

{{INVENTORY_TOPOLOGY}}

#### Mutual links between systems in this document

{{INVENTORY_RELATIONSHIPS}}

**Notes:** {{grid.notes}}

> **Scope:** Configuration documentation only — not a DR runbook. Partnerships and replication policies are topology facts.

### 1.2 Refresh after array changes

```bash
node discover/discover.js --hosts <ip1>[,<ip2>...] --user <u> --pass <p> --write-generated
node build-wiki.js
```

### 1.3 Document maintenance

| Item | Owner / process |
|------|-----------------|
| Re-run discovery after capacity, host, or firmware changes | Storage team |
| Update `config.overrides.yaml` for customer name, site labels, contacts | Documentation owner |
| Rebuild HTML wiki | `node build-wiki.js` |

---
