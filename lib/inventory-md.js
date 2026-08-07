/** Build Markdown tables from inventory.yaml for FS documentation. */

function mdTable(headers, rows) {
  if (!rows.length) return '_None discovered._';
  const head = '| ' + headers.join(' | ') + ' |';
  const sep = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const body = rows
    .map((r) => '| ' + r.map((c) => String(c ?? '')).join(' | ') + ' |')
    .join('\n');
  return [head, sep, body].join('\n');
}

function code(s) {
  if (s == null || s === '') return '';
  const t = String(s).trim();
  if (t.startsWith('`')) return t;
  return '`' + t.replace(/`/g, "'") + '`';
}

function truncate(s, n = 80) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function asList(x) {
  if (Array.isArray(x)) return x;
  if (x == null || x === '' || x === '[]') return [];
  if (typeof x === 'object') return [x];
  return [];
}

function buildInventoryMarkdown(config, inventory) {
  const systems = asList(inventory.systems);
  const pools = asList(inventory.pools);
  const hosts = asList(inventory.hosts);
  const hostClusters = asList(inventory.host_clusters);
  const volumes = asList(inventory.volumes);
  const vgs = asList(inventory.volume_groups);
  const partitions = asList(inventory.partitions);
  const partnerships = asList(inventory.partnerships);
  const policies = asList(inventory.policies);
  const relLinks = asList(inventory.relationship_links);
  const topology =
    inventory.topology && typeof inventory.topology === 'object' ? inventory.topology : {};
  const stats = inventory.stats && typeof inventory.stats === 'object' ? inventory.stats : {};

  const topologyTable = mdTable(
    ['Property', 'Value'],
    [
      ['Deployment class', `**${topology.deployment || config.deployment || ''}**`],
      ['Flash Grid configured', topology.flash_grid || (topology.grid_name ? 'yes' : 'no')],
      ['Flash Grid name', topology.grid_name ? code(topology.grid_name) : '_none reported_'],
      ['Mutual partnerships (in this doc)', topology.mutual_partnerships || '0'],
      ['External partnerships', topology.external_partnerships || '0'],
      ['Classification reason', topology.reason || config.deployment_reason || ''],
    ]
  );

  const relationshipTable = relLinks.length
    ? mdTable(
        ['From', 'To', 'Partnership object', 'Type'],
        relLinks.map((l) => [code(l.from), code(l.to), code(l.partnership), l.type || ''])
      )
    : '_No mutual partnerships detected between systems in this document._';

  const systemsTable = mdTable(
    [
      'Array ID',
      'Model',
      'Firmware',
      'Location',
      'Capacity',
      'Used',
      'Pools',
      'Hosts',
      'Volumes',
      'Flash Grid',
      'Mgmt host',
    ],
    systems.map((s) => [
      code(s.array_id),
      code(s.model),
      `**${s.firmware || ''}**`,
      s.location || '',
      s.capacity || '',
      s.used_capacity || '',
      s.pool_count || '',
      s.host_count || '',
      s.volume_count || '',
      s.grid_name ? code(s.grid_name) : '—',
      code(s.host || ''),
    ])
  );

  const poolsTable = mdTable(
    ['System', 'Pool', 'Status', 'Capacity', 'Free', 'Used', 'Easy Tier'],
    pools.map((p) => [
      code(p.system),
      code(p.name),
      p.status || '',
      p.capacity || '',
      p.free || '',
      p.used || '',
      p.easy_tier || '',
    ])
  );

  const hostsTable = mdTable(
    ['System', 'Host', 'Status', 'Type / protocol', 'IO group', 'Cluster', 'Ports'],
    hosts.map((h) => [
      code(h.system),
      code(h.name),
      h.status || '',
      h.type || '',
      code(h.iogrp),
      code(h.host_cluster),
      h.port_count || '',
    ])
  );

  const hostClustersTable = hostClusters.length
    ? mdTable(
        ['System', 'Host cluster', 'Status', 'Hosts'],
        hostClusters.map((c) => [code(c.system), code(c.name), c.status || '', c.host_count || ''])
      )
    : '_No host clusters discovered._';

  // Cap volume table for readability in wiki (full list still in inventory.yaml)
  const volLimit = 200;
  const volSlice = volumes.slice(0, volLimit);
  const volumesTable =
    mdTable(
      ['System', 'Volume', 'Capacity', 'Status', 'Pool', 'Volume group', 'Type'],
      volSlice.map((v) => [
        code(v.system),
        code(v.name),
        v.capacity || '',
        v.status || '',
        code(v.pool),
        code(v.volume_group),
        v.type || '',
      ])
    ) +
    (volumes.length > volLimit
      ? `\n\n_Showing first ${volLimit} of ${volumes.length} volumes — see inventory.yaml for full list._`
      : '');

  const vgTable = vgs.length
    ? mdTable(
        ['System', 'Volume group', 'Volumes', 'Partition', 'Replication policy'],
        vgs.map((g) => [
          code(g.system),
          code(g.name),
          g.volume_count || '',
          code(g.partition),
          code(g.policy),
        ])
      )
    : '_No volume groups discovered._';

  const partitionsTable = partitions.length
    ? mdTable(
        ['System', 'Partition', 'Type', 'Notes'],
        partitions.map((p) => [code(p.system), code(p.name), p.type || '', truncate(p.notes, 60)])
      )
    : '_No storage partitions discovered._';

  const partnershipsTable = partnerships.length
    ? mdTable(
        ['Local system', 'Partner / name', 'Type', 'Location', 'Links to system in this doc', 'In document'],
        partnerships.map((p) => [
          code(p.system),
          code(p.name),
          p.type || '',
          p.location || '',
          p.link_to ? code(p.link_to) : '—',
          p.in_document || (p.link_to ? 'yes' : 'no'),
        ])
      )
    : '_No partnerships configured (or not visible to this user)._';

  const policiesTable = policies.length
    ? mdTable(
        ['System', 'Policy', 'Topology', 'RPO alert (sec)'],
        policies.map((p) => [code(p.system), code(p.name), code(p.topology), p.rpo_alert || ''])
      )
    : '_No replication policies discovered._';

  return {
    topology: topologyTable,
    relationships: relationshipTable,
    systems: systemsTable,
    pools: poolsTable,
    hosts: hostsTable,
    hostClusters: hostClustersTable,
    volumes: volumesTable,
    volumeGroups: vgTable,
    partitions: partitionsTable,
    partnerships: partnershipsTable,
    policies: policiesTable,
    stats: {
      systemCount: stats.system_count ?? systems.length,
      volumeCount: stats.volume_count ?? volumes.length,
      hostCount: stats.host_count ?? hosts.length,
      poolCount: stats.pool_count ?? pools.length,
      partitionCount: stats.partition_count ?? partitions.length,
      vgCount: stats.volume_group_count ?? vgs.length,
    },
  };
}

function applyInventoryMarkers(text, inv) {
  return text
    .replaceAll('{{INVENTORY_TOPOLOGY}}', inv.topology)
    .replaceAll('{{INVENTORY_RELATIONSHIPS}}', inv.relationships)
    .replaceAll('{{INVENTORY_SYSTEMS}}', inv.systems)
    .replaceAll('{{INVENTORY_POOLS}}', inv.pools)
    .replaceAll('{{INVENTORY_HOSTS}}', inv.hosts)
    .replaceAll('{{INVENTORY_HOST_CLUSTERS}}', inv.hostClusters)
    .replaceAll('{{INVENTORY_VOLUMES}}', inv.volumes)
    .replaceAll('{{INVENTORY_VOLUME_GROUPS}}', inv.volumeGroups)
    .replaceAll('{{INVENTORY_PARTITIONS}}', inv.partitions)
    .replaceAll('{{INVENTORY_PARTNERSHIPS}}', inv.partnerships)
    .replaceAll('{{INVENTORY_POLICIES}}', inv.policies);
}

module.exports = { buildInventoryMarkdown, applyInventoryMarkers };
