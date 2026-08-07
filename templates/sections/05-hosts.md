## 4. Hosts & host clusters

Host objects and host clusters defined on each system.

### 4.1 Connectivity map

{{DIAGRAM_HOSTS_STORAGE}}

### 4.2 Hosts

{{INVENTORY_HOSTS}}

### 4.3 Host clusters

{{INVENTORY_HOST_CLUSTERS}}

**Operational tips:**
- Verify multipathing (Round Robin / vendor PSP) on connected ESXi or other hosts after zoning changes.
- Host object names should match operational naming standards for supportability.
- The map above is logical (host object → array). Physical fabric / switch hops are not discovered via REST.

---
