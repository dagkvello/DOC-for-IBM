## 7. Connectivity & replication (topology)

This section lists **partnerships and replication policies** if present. It does **not** define DR procedures.

Deployment class for this document: **{{deployment_label}}** (`{{deployment}}`).  
Partnership summary: {{partnership.summary}}

### 7.1 Inter-array topology map

{{DIAGRAM_SYSTEMS}}

### 7.2 Partnerships (`lspartnership`)

**Links to system in this doc** is filled when the partnership name matches another array discovered in the same run (e.g. FS5300 ↔ remote peer). Otherwise the partner is external or unmatched.

{{INVENTORY_PARTNERSHIPS}}

### 7.3 Replication policies (`lsreplicationpolicy`)

{{INVENTORY_POLICIES}}

### 7.4 Storage stack map

{{DIAGRAM_STORAGE_STACK}}

If you need failover runbooks (async / sync-DR), use a separate DR documentation project (for example DR-for-IBM-v2).

---
