## 8. Appendices

### A. Refresh workflow

1. Ensure network access to management IPs on port **7443** (REST).
2. Use a read-only / monitor-capable user.
3. Run discovery for all systems in the grid (or the single system):

```bash
node discover/discover.js --hosts <ip1>,<ip2> --user <user> --pass <pass> --write-generated --dump-json discover/dump
```

4. Review `config.generated.yaml` and `inventory.generated.yaml`.
5. Copy over `config.yaml` / `inventory.yaml` (or merge with overrides).
6. Rebuild:

```bash
node build-wiki.js
```

### B. Essential CLI (on-box reference)

```bash
lssystem
lsenclosure
lsmdiskgrp
lshost
lshostcluster
lsvdisk
lsvolumegroup
lspartition
lspartnership
lsreplicationpolicy
lsnode
```

### C. Related projects

- **DOC-for-IBM** (this project): as-built FlashSystem / Flash Grid documentation wiki.
- **DR-for-IBM-v2**: modular disaster recovery runbooks (async / sync-DR) with inventory tokens.

### D. Contacts

| Role | Contact | Notes |
|------|---------|-------|
| Storage owner | _TBD_ | Array changes, discovery schedule |
| Documentation | {{author}} | Wiki rebuild, overrides |

---
