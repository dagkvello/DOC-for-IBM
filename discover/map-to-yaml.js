/**
 * Map one or more FlashSystem snapshots → config.yaml + inventory.yaml (docs).
 */
const { asArray, firstObject } = require('./collect');

function pick(obj, keys) {
  if (!obj) return '';
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return String(obj[k]);
  }
  return '';
}

function parseCapacityTiB(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^([\d.]+)\s*([TGPME]i?B?)?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = (m[2] || '').toUpperCase();
  if (unit.startsWith('P')) n *= 1024;
  else if (unit.startsWith('G')) n /= 1024;
  else if (unit.startsWith('M')) n /= 1024 * 1024;
  else if (unit.startsWith('E')) n *= 1024 * 1024;
  return n;
}

function formatTiB(n, approx = true) {
  if (n == null || Number.isNaN(n)) return '';
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return approx ? `~${rounded} TiB` : `${rounded} TiB`;
}

function formatCapLabel(raw) {
  const t = parseCapacityTiB(raw);
  if (t == null) return raw ? String(raw) : '';
  if (t < 1) return `${Math.round(t * 1024)} GiB`;
  return formatTiB(t, false);
}

function modelFromProduct(product) {
  if (!product) return '';
  const mm = product.match(/FlashSystem\s*(\w+)/i) || product.match(/\bFS\s*(\w+)/i);
  if (mm) return `FS${mm[1]}`.replace(/^FSFS/i, 'FS');
  return product;
}

function mapSystem(snap) {
  const sys = firstObject(snap.commands?.lssystem) || {};
  const name = pick(sys, ['name', 'id', 'cluster_name']) || snap.host || 'unknown';
  const codeLevel = pick(sys, ['code_level']) || '';
  const product = pick(sys, ['product_name', 'product', 'model']);
  const model = modelFromProduct(product) || product;
  const totalCap =
    parseCapacityTiB(pick(sys, ['total_mdisk_capacity', 'total_physical_capacity'])) ||
    sumCapacity(asArray(snap.commands?.lsmdiskgrp), ['capacity', 'real_capacity']);
  const usedCap =
    parseCapacityTiB(pick(sys, ['total_used_capacity', 'total_allocated_extent_capacity'])) ||
    sumCapacity(asArray(snap.commands?.lsmdiskgrp), ['used_capacity', 'real_capacity']);

  const enclosures = asArray(snap.commands?.lsenclosure);
  const nodes = asArray(snap.commands?.lsnode);
  const pools = asArray(snap.commands?.lsmdiskgrp).map((g) => ({
    name: pick(g, ['name', 'id']),
    status: pick(g, ['status']),
    capacity: formatCapLabel(pick(g, ['capacity', 'real_capacity'])),
    free: formatCapLabel(pick(g, ['free_capacity'])),
    used: formatCapLabel(pick(g, ['used_capacity', 'real_capacity'])),
    mdisk_count: pick(g, ['mdisk_count', 'mdisk_count']) || '',
    easy_tier: pick(g, ['easy_tier', 'easy_tier_status']) || '',
  }));

  const hosts = asArray(snap.commands?.lshost).map((h) => ({
    name: pick(h, ['name', 'id']),
    status: pick(h, ['status']),
    type: pick(h, ['type', 'host_type', 'protocol']) || '',
    iogrp: pick(h, ['IO_group_name', 'iogrp_name', 'IO_group_id']) || '',
    port_count: pick(h, ['port_count', 'nqn_count']) || '',
    host_cluster: pick(h, ['host_cluster_name', 'host_cluster_id']) || '',
  }));

  const host_clusters = asArray(snap.commands?.lshostcluster).map((c) => ({
    name: pick(c, ['name', 'id']),
    status: pick(c, ['status']),
    host_count: pick(c, ['host_count']) || '',
  }));

  const volumes = asArray(snap.commands?.lsvdisk).map((v) => ({
    name: pick(v, ['name', 'id']),
    id: pick(v, ['id']),
    capacity: formatCapLabel(pick(v, ['capacity', 'real_capacity'])),
    status: pick(v, ['status']),
    pool: pick(v, ['mdisk_grp_name', 'mdisk_grp_id']) || '',
    volume_group: pick(v, ['volume_group_name', 'volume_group']) || '',
    type: pick(v, ['type', 'function']) || '',
    thin: pick(v, ['se_copy', 'capacity_saving']) || '',
  }));

  const volume_groups = asArray(snap.commands?.lsvolumegroup).map((g) => ({
    name: pick(g, ['name', 'id']),
    partition: pick(g, ['partition_name', 'partition']) || '',
    policy: pick(g, ['replication_policy_name', 'replication_policy']) || '',
    volume_count: pick(g, ['volume_count', 'vdisk_count']) || countVolsInVg(volumes, pick(g, ['name', 'id'])),
  }));

  const partitions = asArray(snap.commands?.lspartition).map((p) => ({
    name: pick(p, ['name', 'id']),
    type: pick(p, ['type', 'partition_type']) || 'storage',
    notes: pick(p, ['uuid']) ? `uuid: ${pick(p, ['uuid'])}` : '',
  }));

  const partnerships = asArray(snap.commands?.lspartnership).map((p) => ({
    name: pick(p, ['name', 'id']),
    type: pick(p, ['type', 'link_type', 'partnership_type', 'relationship']) || '',
    location: pick(p, ['location']) || '',
    status: pick(p, ['status', 'link_status', 'event_log_sequence']) || '',
    code_level: pick(p, ['code_level']) || '',
    // remote system identity when present (varies by code level)
    remote_name:
      pick(p, ['name', 'system_name', 'cluster_name', 'remote_system_name']) || '',
  }));

  const policies = asArray(snap.commands?.lsreplicationpolicy).map((p) => ({
    name: pick(p, ['name', 'id']),
    topology: pick(p, ['topology', 'replication_topology']) || '',
    rpo_alert: pick(p, ['rpo_alert', 'rpoalert']) || '',
  }));

  // Only real Flash Grid name from the array — never invent one
  const gridName = pickFlashGridName(sys);

  return {
    array_id: name,
    host: snap.host || '',
    model,
    product_name: product,
    firmware: codeLevel,
    code_level: codeLevel,
    location: pick(sys, ['location']) || '',
    capacity: formatTiB(totalCap) || '',
    used_capacity: formatTiB(usedCap) || '',
    enclosure_count: String(enclosures.length || pick(sys, ['enclosure_count']) || ''),
    node_count: String(nodes.length || ''),
    pool_count: String(pools.length),
    host_count: String(hosts.length),
    volume_count: String(volumes.length),
    volume_group_count: String(volume_groups.length),
    partition_count: String(partitions.length),
    grid_name: gridName,
    partnership_count: String(partnerships.length),
    policy_count: String(policies.length),
    pools,
    hosts,
    host_clusters,
    volumes,
    volume_groups,
    partitions,
    partnerships,
    policies,
    nodes: nodes.map((n) => ({
      name: pick(n, ['name', 'id']),
      status: pick(n, ['status', 'config_node']),
      iogrp: pick(n, ['IO_group_name', 'IO_group_id']) || '',
      iscsi: pick(n, ['iscsi_name']) || '',
    })),
    _raw_system: sys,
  };
}

function sumCapacity(rows, keys) {
  let total = 0;
  let has = false;
  for (const r of rows) {
    for (const k of keys) {
      const c = parseCapacityTiB(r[k]);
      if (c != null) {
        total += c;
        has = true;
        break;
      }
    }
  }
  return has ? total : null;
}

function countVolsInVg(volumes, vgName) {
  if (!vgName) return '';
  return String(volumes.filter((v) => v.volume_group === vgName).length);
}

/** Extract Flash Grid name from lssystem only when the array reports one. */
function pickFlashGridName(sys) {
  const raw = pick(sys, [
    'flash_grid_name',
    'flashgrid_name',
    'grid_name',
    'flash_grid',
    'gridName',
  ]);
  if (!raw) return '';
  // Treat empty / placeholder values as no grid
  if (/^(none|n\/a|null|undefined|-)$/i.test(raw.trim())) return '';
  return raw.trim();
}

/**
 * Names match for partnership linking (array id vs partnership name).
 * Allows fs5300 vs fs5300-fs01 style partial matches carefully.
 */
function namesLikelySameSystem(a, b) {
  const x = String(a || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  const y = String(b || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  // Avoid ultra-short false positives
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * Classify deployment from discovered systems + partnerships.
 *
 * deployment values:
 *   standalone     — one system, not reporting a Flash Grid
 *   grid_member    — one system that reports a Flash Grid name (peers not in this doc)
 *   flash_grid     — 2+ systems sharing the same Flash Grid name from the arrays
 *   partnership    — 2+ systems not in a grid, but lspartnership links them to each other
 *   multi_system   — 2+ independent systems (no shared grid, no mutual partnership)
 */
function classifyTopology(systems) {
  const members = systems.map((s) => s.array_id);
  const reportedGrids = systems
    .map((s) => (s.grid_name || '').trim())
    .filter(Boolean);
  const uniqueGrids = [...new Set(reportedGrids)];

  // Flash Grid only if 2+ documented systems share one non-empty grid name
  // and that name appears on at least 2 systems (prefer all)
  let inFlashGrid = false;
  let gridName = '';
  if (systems.length >= 2 && uniqueGrids.length === 1) {
    const g = uniqueGrids[0];
    const countWith = systems.filter((s) => s.grid_name === g).length;
    if (countWith >= 2) {
      inFlashGrid = true;
      gridName = g;
    }
  } else if (systems.length === 1 && reportedGrids[0]) {
    gridName = reportedGrids[0];
  }

  // Partnerships that point at another system in this discovery set
  const crossLinks = [];
  const externalPartners = [];
  for (const s of systems) {
    for (const p of s.partnerships || []) {
      const partnerLabel = p.remote_name || p.name || '';
      let matched = null;
      for (const other of systems) {
        if (other.array_id === s.array_id) continue;
        if (
          namesLikelySameSystem(partnerLabel, other.array_id) ||
          namesLikelySameSystem(p.name, other.array_id)
        ) {
          matched = other.array_id;
          break;
        }
      }
      if (matched) {
        crossLinks.push({
          from: s.array_id,
          to: matched,
          partnership: p.name,
          type: p.type || '',
          location: p.location || '',
        });
      } else if (partnerLabel) {
        externalPartners.push({
          system: s.array_id,
          partnership: p.name,
          type: p.type || '',
          location: p.location || '',
        });
      }
    }
  }

  // Deduplicate undirected pairs for summary
  const pairKeys = new Set();
  const uniqueCross = [];
  for (const l of crossLinks) {
    const key = [l.from, l.to].sort().join('|');
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);
    uniqueCross.push(l);
  }

  let deployment;
  let reason;
  if (systems.length === 1) {
    if (gridName) {
      deployment = 'grid_member';
      reason = `Single system reports Flash Grid name "${gridName}" (other grid members not included in this discovery)`;
    } else {
      deployment = 'standalone';
      reason = 'Single system; no Flash Grid name reported on lssystem';
    }
  } else if (inFlashGrid) {
    deployment = 'flash_grid';
    reason = `Systems share Flash Grid name "${gridName}" from array configuration`;
  } else if (uniqueCross.length > 0) {
    deployment = 'partnership';
    reason = `No shared Flash Grid; ${uniqueCross.length} partnership link(s) between documented systems`;
  } else {
    deployment = 'multi_system';
    reason =
      'Multiple systems in one document; no shared Flash Grid name and no mutual partnership detected between them';
  }

  const hasAnyPartnership = systems.some(
    (s) => (s.partnerships && s.partnerships.length) || parseInt(s.partnership_count, 10) > 0
  );

  return {
    deployment,
    reason,
    gridName: inFlashGrid || systems.length === 1 ? gridName : gridName || '',
    inFlashGrid,
    crossLinks: uniqueCross,
    allCrossLinks: crossLinks,
    externalPartners,
    hasAnyPartnership,
    members,
  };
}

function deploymentTitles(topo, systems, primary) {
  const n = systems.length;
  const ids = systems.map((s) => s.array_id).join(', ');
  switch (topo.deployment) {
    case 'flash_grid':
      return {
        title: 'FlashSystem Grid Documentation',
        subtitle: `Flash Grid \`${topo.gridName}\` — ${n} member(s)`,
        scope_label: topo.gridName,
        scope_kind: 'Flash Grid',
        notes: `Members documented: ${ids}. Classified as Flash Grid because arrays report the same grid name.`,
      };
    case 'grid_member':
      return {
        title: 'FlashSystem Documentation',
        subtitle: `Grid member \`${primary.array_id}\` (grid \`${topo.gridName}\`)`,
        scope_label: topo.gridName || primary.array_id,
        scope_kind: 'Grid member',
        notes: `System reports Flash Grid "${topo.gridName}". Other members were not included in this discovery run.`,
      };
    case 'partnership':
      return {
        title: 'FlashSystem Site Documentation',
        subtitle: `${n} systems with storage partnership`,
        scope_label: `site:${ids}`,
        scope_kind: 'Partnership',
        notes: `Not a Flash Grid. Detected partnership between documented systems. ${topo.reason}`,
      };
    case 'multi_system':
      return {
        title: 'FlashSystem Site Documentation',
        subtitle: `${n} independent systems (no Flash Grid)`,
        scope_label: `site:${ids}`,
        scope_kind: 'Multi-system (independent)',
        notes:
          'Systems are documented together for this site, but discovery did not find a shared Flash Grid name or a mutual partnership between them (e.g. primary + Veeam backup array).',
      };
    default:
      return {
        title: 'FlashSystem Documentation',
        subtitle: `Standalone system inventory — ${primary.array_id}`,
        scope_label: primary.array_id,
        scope_kind: 'Standalone',
        notes: 'Single standalone system; no Flash Grid membership reported.',
      };
  }
}

/**
 * @param {object[]} snapshots - one or more collect() results
 * @param {object} [overrides]
 */
function mapDiscovery(snapshots, overrides = {}) {
  if (!snapshots || !snapshots.length) throw new Error('No system snapshots to map');

  const systems = snapshots.map(mapSystem);
  const primary = systems[0];
  const topo = classifyTopology(systems);
  const titles = deploymentTitles(topo, systems, primary);

  const allPools = [];
  const allHosts = [];
  const allVolumes = [];
  const allVgs = [];
  const allParts = [];
  const allPartners = [];
  const allPolicies = [];
  const allHostClusters = [];

  for (const s of systems) {
    for (const p of s.pools) allPools.push({ system: s.array_id, ...p });
    for (const h of s.hosts) allHosts.push({ system: s.array_id, ...h });
    for (const v of s.volumes) allVolumes.push({ system: s.array_id, ...v });
    for (const g of s.volume_groups) allVgs.push({ system: s.array_id, ...g });
    for (const p of s.partitions) allParts.push({ system: s.array_id, ...p });
    for (const p of s.partnerships) allPartners.push({ system: s.array_id, ...p });
    for (const p of s.policies) allPolicies.push({ system: s.array_id, ...p });
    for (const c of s.host_clusters) allHostClusters.push({ system: s.array_id, ...c });
  }

  // Annotate partnerships with link_to when peer is in this doc
  for (const p of allPartners) {
    const peer = systems.find(
      (s) =>
        s.array_id !== p.system &&
        (namesLikelySameSystem(p.name, s.array_id) ||
          namesLikelySameSystem(p.remote_name, s.array_id))
    );
    p.link_to = peer ? peer.array_id : '';
    p.in_document = peer ? 'yes' : 'no';
  }

  const totalVols = systems.reduce((n, s) => n + (parseInt(s.volume_count, 10) || 0), 0);
  const totalHosts = systems.reduce((n, s) => n + (parseInt(s.host_count, 10) || 0), 0);
  const totalPools = systems.reduce((n, s) => n + (parseInt(s.pool_count, 10) || 0), 0);

  const codeLevels = [...new Set(systems.map((s) => s.code_level).filter(Boolean))];
  const discoveredAt = new Date().toISOString().slice(0, 10);

  const inventory = {
    topology: {
      deployment: topo.deployment,
      reason: topo.reason,
      flash_grid: topo.inFlashGrid ? 'yes' : 'no',
      grid_name: topo.gridName || '',
      mutual_partnerships: String(topo.crossLinks.length),
      external_partnerships: String(topo.externalPartners.length),
    },
    relationship_links: topo.crossLinks.map((l) => ({
      from: l.from,
      to: l.to,
      partnership: l.partnership,
      type: l.type,
    })),
    systems: systems.map((s) => ({
      array_id: s.array_id,
      host: s.host,
      model: s.model,
      firmware: s.firmware,
      location: s.location,
      capacity: s.capacity,
      used_capacity: s.used_capacity,
      enclosure_count: s.enclosure_count,
      node_count: s.node_count,
      pool_count: s.pool_count,
      host_count: s.host_count,
      volume_count: s.volume_count,
      volume_group_count: s.volume_group_count,
      partition_count: s.partition_count,
      // Only real grid name from that array — do not copy invented site labels
      grid_name: s.grid_name || '',
      partnership_count: s.partnership_count,
      policy_count: s.policy_count,
    })),
    pools: allPools,
    hosts: allHosts,
    host_clusters: allHostClusters,
    volumes: allVolumes,
    volume_groups: allVgs,
    partitions: allParts,
    partnerships: allPartners,
    policies: allPolicies,
    stats: {
      system_count: systems.length,
      volume_count: totalVols,
      host_count: totalHosts,
      pool_count: totalPools,
      partition_count: allParts.length,
      volume_group_count: allVgs.length,
      partnership_count: allPartners.length,
      mutual_partnership_count: topo.crossLinks.length,
    },
  };

  const config = {
    customer: {
      name: 'Customer Inc',
      audience: 'Storage administrators; Architects; Auditors',
    },
    author: '',
    doc_version: '1.0',
    date: discoveredAt,
    code_level: codeLevels[0] || '',
    code_levels: codeLevels.join(', '),
    title: titles.title,
    subtitle: titles.subtitle,
    deployment: topo.deployment,
    deployment_label: titles.scope_kind,
    deployment_reason: topo.reason,
    scope: {
      label: titles.scope_label,
      kind: titles.scope_kind,
      members: systems.map((s) => s.array_id).join(', '),
      member_count: systems.length,
    },
    grid: {
      // Empty when not a real Flash Grid
      name: topo.inFlashGrid || topo.deployment === 'grid_member' ? topo.gridName : '',
      configured: topo.inFlashGrid || topo.deployment === 'grid_member' ? 'yes' : 'no',
      notes: titles.notes,
      member_count: topo.inFlashGrid ? systems.length : topo.gridName ? 1 : 0,
      members: topo.inFlashGrid ? systems.map((s) => s.array_id).join(', ') : '',
    },
    partnership: {
      mutual_count: topo.crossLinks.length,
      has_any: topo.hasAnyPartnership ? 'yes' : 'no',
      summary:
        topo.crossLinks.length > 0
          ? topo.crossLinks.map((l) => `${l.from} ↔ ${l.to}`).join('; ')
          : topo.hasAnyPartnership
            ? 'Partnerships present but not linking documented peers (or peer outside this discovery)'
            : 'No partnerships discovered',
    },
    // Primary system convenience tokens (first host)
    system: {
      array_id: primary.array_id,
      model: primary.model,
      firmware: primary.firmware,
      location: primary.location,
      capacity: primary.capacity,
      host: primary.host,
    },
    metrics: {
      systems: String(systems.length),
      volumes: String(totalVols),
      hosts: String(totalHosts),
      pools: String(totalPools),
    },
  };

  const meta = {
    discovered_at: new Date().toISOString(),
    system_count: systems.length,
    deployment: topo.deployment,
    deployment_reason: topo.reason,
    flash_grid: topo.inFlashGrid,
    grid_name: topo.gridName || null,
    mutual_partnerships: topo.crossLinks,
    systems: systems.map((s) => ({
      array_id: s.array_id,
      model: s.model,
      firmware: s.firmware,
      volumes: s.volume_count,
      hosts: s.host_count,
      pools: s.pool_count,
      grid_name: s.grid_name || null,
      partnerships: (s.partnerships || []).map((p) => p.name),
    })),
  };

  return {
    config: mergeConfig(config, stripInternal(overrides.config || overrides)),
    inventory: mergeInventory(inventory, stripInternal(overrides.inventory || {})),
    meta,
  };
}

function stripInternal(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_') || k === 'inventory') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? stripInternal(v) : v;
  }
  return out;
}

function deepMerge(base, over) {
  if (over === null || over === undefined) return base;
  if (Array.isArray(over)) return over.slice();
  if (typeof over !== 'object') return over;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return out;
}

function mergeConfig(discovered, overrides) {
  if (!overrides || !Object.keys(overrides).length) return discovered;
  return deepMerge(discovered, overrides);
}

function mergeInventory(discovered, overrides) {
  if (!overrides || !Object.keys(overrides).length) return discovered;
  // Overrides can annotate systems by array_id
  const out = { ...discovered, ...overrides };
  if (Array.isArray(overrides.systems) && Array.isArray(discovered.systems)) {
    out.systems = discovered.systems.map((s) => {
      const ov = overrides.systems.find((x) => x.array_id === s.array_id);
      return ov ? { ...s, ...ov } : s;
    });
  }
  return out;
}

module.exports = {
  mapDiscovery,
  mapSystem,
  mergeConfig,
  mergeInventory,
  parseCapacityTiB,
  formatTiB,
};
