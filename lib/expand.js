const fs = require('fs');
const path = require('path');

/**
 * Expand <!-- @include relative/path.md --> directives (recursive).
 * Paths are resolved relative to the file that contains the include.
 */
function expandIncludes(text, baseDir, stack = []) {
  return text.replace(
    /<!--\s*@include\s+([^\s>]+)\s*-->/g,
    (_, rel) => {
      const clean = rel.trim();
      const abs = path.resolve(baseDir, clean);
      if (stack.includes(abs)) {
        throw new Error(`Circular @include: ${[...stack, abs].join(' → ')}`);
      }
      if (!fs.existsSync(abs)) {
        throw new Error(`@include not found: ${clean} (from ${baseDir})`);
      }
      const body = fs.readFileSync(abs, 'utf8');
      return expandIncludes(body, path.dirname(abs), [...stack, abs]);
    }
  );
}

function expandFile(filePath) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  return expandIncludes(text, path.dirname(abs), [abs]);
}

module.exports = { expandIncludes, expandFile };
