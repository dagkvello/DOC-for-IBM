/**
 * Minimal YAML loader (same subset as plan-generator Phase 1).
 */
const fs = require('fs');

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function loadYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root = {};
  const stack = [{ indent: -1, container: root }];

  function current() {
    return stack[stack.length - 1];
  }
  function popTo(indent) {
    while (stack.length > 1 && current().indent >= indent) stack.pop();
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    let line = stripComment(lines[lineNo]);
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();
    popTo(indent);
    const ctx = current();

    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2);
      if (!Array.isArray(ctx.container)) {
        throw new Error(`YAML array item without array context at line ${lineNo + 1}`);
      }
      if (rest.includes(':')) {
        const obj = {};
        ctx.container.push(obj);
        stack.push({ indent, container: obj });
        const idx = rest.indexOf(':');
        const key = rest.slice(0, idx).trim();
        const val = rest.slice(idx + 1);
        if (val.trim() === '') {
          const nested = {};
          obj[key] = nested;
          stack.push({ indent: indent + 2, container: nested });
        } else {
          obj[key] = parseScalar(val);
        }
      } else {
        ctx.container.push(parseScalar(rest));
      }
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon === -1) throw new Error(`YAML parse error at line ${lineNo + 1}`);
    const key = trimmed.slice(0, colon).trim();
    const valPart = trimmed.slice(colon + 1);
    if (!ctx.container || Array.isArray(ctx.container)) {
      throw new Error(`YAML map key in non-map context at line ${lineNo + 1}`);
    }
    if (valPart.trim() === '') {
      let nextTrim = '';
      let nextIndent = null;
      for (let j = lineNo + 1; j < lines.length; j++) {
        const peek = stripComment(lines[j]);
        if (!peek.trim()) continue;
        nextIndent = peek.match(/^ */)[0].length;
        nextTrim = peek.trim();
        break;
      }
      if (nextTrim.startsWith('- ') && nextIndent > indent) {
        const arr = [];
        ctx.container[key] = arr;
        stack.push({ indent, container: arr });
      } else {
        const nested = {};
        ctx.container[key] = nested;
        stack.push({ indent, container: nested });
      }
    } else {
      ctx.container[key] = parseScalar(valPart);
    }
  }
  return root;
}

function loadYamlFile(filePath) {
  return loadYaml(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { loadYaml, loadYamlFile };
