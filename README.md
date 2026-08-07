# DOC-for-IBM — FlashSystem / Flash Grid documentation wiki

As-built **configuration documentation** for IBM FlashSystem:

- **One** standalone system, or  
- **Two or more** systems in a **Flash Grid** (or any set you choose to document together)

Same modular approach and wiki look-and-feel as **DR-for-IBM-v2**, but **no DR runbooks** — inventory, topology, and capacity only.

| Concern | Where |
|--------|--------|
| Customer name, author, notes | `config.overrides.yaml` |
| Live array data | `node discover/discover.js` → `config.yaml` + `inventory.yaml` |
| Section prose | `templates/sections/*.md` |
| Wiki HTML | `node build-wiki.js` → `out/FS_Documentation.html` |

**Related:** DR failover plans live in `DR-for-IBM-v2` / customer forks — not here.

---

## Quick start

Requires **Node.js** only (no npm packages).

```bash
cd C:\Projects\Code\DOC-for-IBM

# 1) Demo discovery (2-system grid fixtures: Oslo + Trondheim)
node discover/discover.js --mock

# 2) Build wiki
node build-wiki.js

# Open
#   out\FS_Documentation.html
```

### Live systems

```bash
# Single system
node discover/discover.js --host 10.1.1.1 --user monitor --pass '***' --write-generated

# Flash Grid / multiple systems
node discover/discover.js --hosts 10.1.1.1,10.2.2.2 --user monitor --pass '***' --write-generated --dump-json discover/dump

# Or repeat --host
node discover/discover.js --host 10.1.1.1 --host 10.2.2.2 --user monitor --pass '***'

# Build wiki (uses *.generated.yaml automatically if config.yaml is missing)
node build-wiki.js

# Or force generated / promote to active names:
node build-wiki.js --generated
node build-wiki.js --promote
```

`build-wiki.js` resolution order:

1. `--config` / `--inventory` if given  
2. `--generated` → `config.generated.yaml` + `inventory.generated.yaml`  
3. `config.yaml` / `inventory.yaml` **if they exist**  
4. else fall back to `*.generated.yaml` (so `discover --write-generated` works without a copy step)

Environment variables: `FS_HOST`, `FS_HOSTS`, `FS_USER`, `FS_PASS`, `FS_PORT`.

---

## Update cycle (when the array changes)

```text
FlashSystem change (hosts, volumes, firmware, …)
        │
        ▼
node discover/discover.js --hosts … --user … --pass …
        │
        ▼
config.yaml + inventory.yaml  (+ overrides merge)
        │
        ▼
node build-wiki.js
        │
        ▼
out/FS_Documentation.html
```

---

## Layout

```
DOC-for-IBM/
├── config.yaml / config.overrides.yaml
├── inventory.yaml
├── build-wiki.js
├── md-convert.js
├── discover/
│   ├── discover.js          # CLI
│   ├── flash-client.js      # REST :7443
│   ├── collect.js           # lssystem, pools, hosts, volumes, …
│   ├── map-to-yaml.js
│   ├── yaml-emit.js
│   └── fixtures/            # mock 2-system grid
├── lib/                     # tokens, inventory tables, expand, yaml
├── templates/
│   ├── plan.md
│   └── sections/            # 01–09 documentation sections
└── out/
    ├── FS_Documentation.md
    └── FS_Documentation.html
```

---

## What discovery collects

| REST command | Section |
|--------------|---------|
| `lssystem`, `lsenclosure`, `lsnode` | Systems |
| `lsmdiskgrp` | Capacity / pools |
| `lshost`, `lshostcluster` | Hosts |
| `lsvdisk`, `lsvolumegroup` | Volumes |
| `lspartition` | Partitions |
| `lspartnership`, `lsreplicationpolicy` | Connectivity facts only |

Auth: `/rest/v1/auth` or `/rest/auth` with `X-Auth-Username` / `X-Auth-Password`. Self-signed TLS accepted by default (`--secure` to verify).

---

## Wiki sections

1. Overview  
2. Systems  
3. Capacity & storage pools  
4. Hosts & host clusters  
5. Volumes & volume groups  
6. Storage partitions  
7. Connectivity & replication (topology — not a DR plan)  
8. Appendices  

---

## Lint

```bash
node build-wiki.js --lint
```

---

## Relationship to DR-for-IBM-v2

| | **DOC-for-IBM** | **DR-for-IBM-v2** |
|--|----------------|-------------------|
| Purpose | As-built inventory wiki | Failover / failback runbooks |
| Scope | 1..N systems / grid | Prod + DR pair, async/sync plans |
| Output | `FS_Documentation.html` | `DR_Plan_Async/Sync.html` |
| Shared ideas | REST discovery, YAML, modular MD, Tailwind wiki | same |

You can run both projects against the same arrays for different audiences (ops inventory vs DR procedures).
