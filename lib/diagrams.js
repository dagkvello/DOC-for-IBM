/**
 * Generate Mermaid topology diagrams from discovered inventory.
 * Used by DOC-for-IBM and PBHA-for-IBM wiki builders.
 */

function asList(x) {
  if (Array.isArray(x)) return x;
  if (x == null || x === '' || x === '[]') return [];
  if (typeof x === 'object') return [x];
  return [];
}

/** Mermaid node id: letters, digits, underscore only */
function mid(prefix, name, index) {
  const base = String(name || `n${index}`)
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  const safe = base && /^[A-Za-z]/.test(base) ? base : `n_${base || index}`;
  return `${prefix}_${safe}_${index}`;
}

function escLabel(s) {
  return String(s || '')
    .replace(/"/g, "'")
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

function fence(mermaidBody) {
  return '```mermaid\n' + mermaidBody.trim() + '\n```';
}

/**
 * Systems + partnerships (+ optional Flash Grid box).
 */
function diagramSystemsTopology(config, inventory) {
  const systems = asList(inventory.systems);
  const relLinks = asList(inventory.relationship_links);
  const partnerships = asList(inventory.partnerships);
  const topology =
    inventory.topology && typeof inventory.topology === 'object' ? inventory.topology : {};

  if (!systems.length) {
    return '_No systems to diagram._';
  }

  const lines = ['flowchart TB'];
  const idByArray = new Map();

  systems.forEach((s, i) => {
    const id = mid('sys', s.array_id, i);
    idByArray.set(String(s.array_id || '').toLowerCase(), id);
    const label = [
      escLabel(s.array_id || 'system'),
      escLabel(s.model || ''),
      escLabel(s.location || ''),
    ]
      .filter(Boolean)
      .join('<br/>');
    lines.push(`  ${id}["${label}"]`);
  });

  // Mutual relationship links first
  const edgeKeys = new Set();
  for (const l of relLinks) {
    const a = idByArray.get(String(l.from || '').toLowerCase());
    const b = idByArray.get(String(l.to || '').toLowerCase());
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().join('|');
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const t = escLabel(l.type || 'partnership') || 'link';
    lines.push(`  ${a} <-->|"${t}"| ${b}`);
  }

  // Partnerships that only show on one side (external or unmatched)
  let ext = 0;
  for (const p of partnerships) {
    if (p.link_to || p.in_document === 'yes') continue;
    const a = idByArray.get(String(p.system || '').toLowerCase());
    if (!a) continue;
    const eid = mid('ext', p.name, ext++);
    lines.push(`  ${eid}(["${escLabel(p.name || 'remote')}<br/>external"])`);
    lines.push(`  ${a} -.->|"${escLabel(p.type || 'partnership')}"| ${eid}`);
  }

  if (topology.grid_name) {
    lines.push(`  grid[["Flash Grid<br/>${escLabel(topology.grid_name)}"]]`);
    for (const id of idByArray.values()) {
      lines.push(`  grid --- ${id}`);
    }
  }

  const title =
    systems.length > 1
      ? '### Systems & inter-array links\n\n'
      : '### System overview\n\n';
  return title + fence(lines.join('\n'));
}

/**
 * Hosts (and clusters) connected to storage systems.
 */
function diagramHostsStorage(config, inventory, opts = {}) {
  const maxHosts = opts.maxHosts || 30;
  const systems = asList(inventory.systems);
  const hosts = asList(inventory.hosts);
  const clusters = asList(inventory.host_clusters);

  if (!systems.length) return '_No systems to diagram._';
  if (!hosts.length && !clusters.length) {
    return '_No hosts or host clusters discovered — host↔storage map omitted._';
  }

  const lines = ['flowchart LR'];
  const sysIds = new Map();

  systems.forEach((s, i) => {
    const id = mid('S', s.array_id, i);
    sysIds.set(String(s.array_id || '').toLowerCase(), id);
    lines.push(`  ${id}["${escLabel(s.array_id)}<br/>${escLabel(s.model)}"]`);
  });

  // Prefer host clusters as groups when present
  const clusterKeys = new Set();
  clusters.forEach((c, i) => {
    const cid = mid('HC', c.name, i);
    const sid = sysIds.get(String(c.system || '').toLowerCase());
    if (!sid) return;
    clusterKeys.add(`${c.system}|${c.name}`);
    lines.push(`  ${cid}(["cluster: ${escLabel(c.name)}<br/>${escLabel(c.host_count)} hosts"])`);
    lines.push(`  ${cid} -->|"mapped / zoned"| ${sid}`);
  });

  const slice = hosts.slice(0, maxHosts);
  let drawn = 0;
  slice.forEach((h, i) => {
    const key = `${h.system}|${h.host_cluster}`;
    // If host is already represented via cluster box, skip individual unless no cluster
    if (h.host_cluster && clusterKeys.has(key) && hosts.length > maxHosts / 2) {
      return;
    }
    const hid = mid('H', h.name, i);
    const sid = sysIds.get(String(h.system || '').toLowerCase());
    if (!sid) return;
    const proto = escLabel(h.type || 'host');
    lines.push(`  ${hid}("${escLabel(h.name)}<br/>${proto}")`);
    lines.push(`  ${hid} -->|"${proto || 'FC/NVMe'}"| ${sid}`);
    drawn++;
  });

  let note = '';
  if (hosts.length > maxHosts) {
    note = `\n\n_Showing up to ${maxHosts} hosts (${hosts.length} total). Full list is in the Hosts table / inventory.yaml._`;
  } else if (!drawn && clusters.length) {
    note = '\n\n_Host clusters summarized; expand host list in the Hosts section._';
  }

  return '### Host ↔ storage connectivity\n\n' + fence(lines.join('\n')) + note;
}

/**
 * Logical storage stack: system → pools → volume groups (capped).
 */
function diagramStorageStack(config, inventory, opts = {}) {
  const maxPools = opts.maxPools || 12;
  const maxVgs = opts.maxVgs || 16;
  const systems = asList(inventory.systems);
  const pools = asList(inventory.pools);
  const vgs = asList(inventory.volume_groups);

  if (!systems.length) return '_No systems to diagram._';
  if (!pools.length && !vgs.length) {
    return '_No pools or volume groups to diagram._';
  }

  const lines = ['flowchart TB'];
  const sysIds = new Map();

  systems.forEach((s, i) => {
    const id = mid('ST', s.array_id, i);
    sysIds.set(String(s.array_id || '').toLowerCase(), id);
    lines.push(`  ${id}["${escLabel(s.array_id)}"]`);
  });

  pools.slice(0, maxPools).forEach((p, i) => {
    const pid = mid('P', p.name, i);
    const sid = sysIds.get(String(p.system || '').toLowerCase());
    if (!sid) return;
    lines.push(`  ${pid}["pool: ${escLabel(p.name)}<br/>${escLabel(p.capacity)}"]`);
    lines.push(`  ${sid} --> ${pid}`);
  });

  vgs.slice(0, maxVgs).forEach((g, i) => {
    const gid = mid('VG', g.name, i);
    const sid = sysIds.get(String(g.system || '').toLowerCase());
    if (!sid) return;
    const pol = g.policy ? `<br/>${escLabel(g.policy)}` : '';
    lines.push(`  ${gid}(["VG: ${escLabel(g.name)}${pol}"])`);
    lines.push(`  ${sid} --> ${gid}`);
  });

  let note = '';
  if (pools.length > maxPools || vgs.length > maxVgs) {
    note = `\n\n_Diagram capped (pools ${Math.min(pools.length, maxPools)}/${pools.length}, VGs ${Math.min(vgs.length, maxVgs)}/${vgs.length})._`;
  }

  return '### Storage stack (pools & volume groups)\n\n' + fence(lines.join('\n')) + note;
}

/**
 * PBHA / HA-oriented view: sites, HA link, hosts on each side.
 */
function diagramPbhaHa(config, inventory, opts = {}) {
  const maxHostsPerSite = opts.maxHostsPerSite || 8;
  const systems = asList(inventory.systems);
  const hosts = asList(inventory.hosts);
  const haPolicies = asList(inventory.ha_policies);
  const relLinks = asList(inventory.relationship_links);

  if (systems.length < 1) return '_No systems to diagram._';

  const lines = ['flowchart LR'];
  const sysIds = new Map();

  systems.forEach((s, i) => {
    const id = mid('HA', s.array_id, i);
    sysIds.set(String(s.array_id || '').toLowerCase(), id);
    const loc = escLabel(s.location || s.array_id);
    lines.push(`  subgraph site_${i} ["${loc}"]`);
    lines.push(`    ${id}["${escLabel(s.array_id)}<br/>${escLabel(s.model)}"]`);
    lines.push('  end');
  });

  // HA / partnership edges
  if (relLinks.length) {
    for (const l of relLinks) {
      const a = sysIds.get(String(l.from || '').toLowerCase());
      const b = sysIds.get(String(l.to || '').toLowerCase());
      if (!a || !b) continue;
      const label = haPolicies.length ? 'PBHA / sync HA' : escLabel(l.type || 'partnership');
      lines.push(`  ${a} <-->|"${label}"| ${b}`);
    }
  } else if (systems.length === 2) {
    const ids = [...sysIds.values()];
    lines.push(`  ${ids[0]} <-->|"HA link (verify)"| ${ids[1]}`);
  }

  // Hosts per system
  for (const s of systems) {
    const sid = sysIds.get(String(s.array_id || '').toLowerCase());
    if (!sid) continue;
    const siteHosts = hosts.filter((h) => h.system === s.array_id).slice(0, maxHostsPerSite);
    siteHosts.forEach((h, i) => {
      const hid = mid('HH', `${s.array_id}_${h.name}`, i);
      lines.push(`  ${hid}("${escLabel(h.name)}")`);
      lines.push(`  ${hid} --- ${sid}`);
    });
  }

  if (haPolicies.length) {
    const pol = haPolicies.map((p) => escLabel(p.name)).filter(Boolean).slice(0, 3).join(', ');
    lines.push(`  pol[["HA policy<br/>${pol || '2-site-ha'}"]]`);
    for (const id of sysIds.values()) {
      lines.push(`  pol -.-> ${id}`);
    }
  }

  return '### PBHA / high-availability topology\n\n' + fence(lines.join('\n'));
}

/**
 * Combined block for inventory markers.
 */
function buildDiagrams(config, inventory, mode = 'doc') {
  const systems = diagramSystemsTopology(config, inventory);
  const hosts = diagramHostsStorage(config, inventory);
  const storage = diagramStorageStack(config, inventory);
  const pbha = diagramPbhaHa(config, inventory);

  return {
    systems,
    hosts,
    storage,
    pbha,
    // Convenience combined sections
    allDoc: [systems, hosts, storage].join('\n\n'),
    allPbha: [pbha, systems, hosts, storage].join('\n\n'),
  };
}

function applyDiagramMarkers(text, diagrams, mode = 'doc') {
  return text
    .replaceAll('{{DIAGRAM_SYSTEMS}}', diagrams.systems || '')
    .replaceAll('{{DIAGRAM_HOSTS_STORAGE}}', diagrams.hosts || '')
    .replaceAll('{{DIAGRAM_STORAGE_STACK}}', diagrams.storage || '')
    .replaceAll('{{DIAGRAM_PBHA}}', diagrams.pbha || '')
    .replaceAll('{{DIAGRAM_ALL}}', mode === 'pbha' ? diagrams.allPbha : diagrams.allDoc);
}

module.exports = {
  buildDiagrams,
  applyDiagramMarkers,
  diagramSystemsTopology,
  diagramHostsStorage,
  diagramStorageStack,
  diagramPbhaHa,
};
