/** Flatten config.yaml into {{token}} map for documentation templates. */

function buildTokens(config) {
  const c = config.customer || {};
  const grid = config.grid || {};
  const scope = config.scope || {};
  const partnership = config.partnership || {};
  const system = config.system || {};
  const metrics = config.metrics || {};

  const tokens = {
    'customer.name': c.name || 'Customer',
    audience: c.audience || 'Storage administrators',
    author: config.author || '',
    doc_version: String(config.doc_version || '1.0'),
    date: config.date || '',
    code_level: config.code_level || '',
    code_levels: config.code_levels || config.code_level || '',
    title: config.title || 'FlashSystem Documentation',
    subtitle: config.subtitle || 'System inventory',
    deployment: config.deployment || 'standalone',
    deployment_label: config.deployment_label || config.deployment || 'standalone',
    deployment_reason: config.deployment_reason || '',

    'scope.label': scope.label || grid.name || system.array_id || '',
    'scope.kind': scope.kind || '',
    'scope.members': scope.members || '',
    'scope.member_count': String(scope.member_count ?? ''),

    'grid.name': grid.name || '',
    'grid.notes': grid.notes || '',
    'grid.configured': grid.configured || (grid.name ? 'yes' : 'no'),
    'grid.member_count': String(grid.member_count ?? ''),
    'grid.members': grid.members || '',

    'partnership.summary': partnership.summary || '',
    'partnership.has_any': partnership.has_any || 'no',
    'partnership.mutual_count': String(partnership.mutual_count ?? '0'),

    'system.array_id': system.array_id || '',
    'system.model': system.model || '',
    'system.firmware': system.firmware || '',
    'system.location': system.location || '',
    'system.capacity': system.capacity || '',
    'system.host': system.host || '',

    'metrics.systems': String(metrics.systems ?? ''),
    'metrics.volumes': String(metrics.volumes ?? ''),
    'metrics.hosts': String(metrics.hosts ?? ''),
    'metrics.pools': String(metrics.pools ?? ''),
  };

  return tokens;
}

function applyTokens(text, tokens) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) {
      const v = tokens[key];
      return v == null ? '' : String(v);
    }
    return m;
  });
}

module.exports = { buildTokens, applyTokens };
