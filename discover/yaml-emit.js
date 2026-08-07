/**
 * Minimal YAML emitter for our config/inventory subset (no external deps).
 */

function escapeString(s) {
  const str = String(s);
  if (str === '') return '""';
  if (/^[\w.@/+%-]+$/.test(str) && !/^(true|false|null|~)$/i.test(str)) {
    return str;
  }
  // Prefer double quotes; escape \ and "
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function emit(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return escapeString(value);

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (!keys.length) return `${pad}- {}`;
          const lines = [];
          keys.forEach((k, i) => {
            const v = item[k];
            const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
            if (v !== null && typeof v === 'object') {
              lines.push(`${prefix}${k}:`);
              const nested = emit(v, indent + 2);
              nested.split('\n').forEach((line) => {
                if (line) lines.push(line);
              });
            } else {
              lines.push(`${prefix}${k}: ${emit(v, 0)}`);
            }
          });
          return lines.join('\n');
        }
        return `${pad}- ${emit(item, 0)}`;
      })
      .join('\n');
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return keys
      .map((k) => {
        const v = value[k];
        if (v !== null && typeof v === 'object') {
          const nested = emit(v, indent + 1);
          if (nested === '[]' || nested === '{}') {
            return `${pad}${k}: ${nested}`;
          }
          return `${pad}${k}:\n${nested}`;
        }
        return `${pad}${k}: ${emit(v, 0)}`;
      })
      .join('\n');
  }

  return escapeString(value);
}

function emitDocument(obj, headerComments = []) {
  const lines = [];
  for (const c of headerComments) {
    lines.push(c.startsWith('#') ? c : `# ${c}`);
  }
  if (headerComments.length) lines.push('');
  lines.push(emit(obj, 0));
  lines.push('');
  return lines.join('\n');
}

module.exports = { emit, emitDocument, escapeString };
