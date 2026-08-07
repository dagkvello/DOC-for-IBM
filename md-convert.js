function slugify(text) {
  return text
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function parseTable(lines) {
  const rows = lines.filter(l => l.trim().startsWith('|'));
  if (rows.length < 2) return null;
  const parseRow = row => row.split('|').slice(1, -1).map(c => c.trim());
  const header = parseRow(rows[0]);
  const body = rows.slice(2).map(parseRow);
  let html = '<div class="table-scroll"><table><thead><tr>';
  header.forEach((h, i) => {
    html += `<th${i === 0 ? ' class="col-first"' : ''}>${inlineMd(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  body.forEach(row => {
    html += '<tr>';
    row.forEach((cell, i) => {
      html += `<td${i === 0 ? ' class="col-first"' : ''}>${inlineMd(cell)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function isChecklistItem(line) {
  return /^- \[ \] /.test(line) || /^- \[x\] /i.test(line);
}

function convertMdToHtml(source) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];
  let inList = false;
  let listType = 'ul';
  let checklist = false;

  const closeList = () => {
    if (inList) {
      out.push(`</${listType}>`);
      inList = false;
      checklist = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = line.slice(3).trim().toLowerCase();
        codeBuf = [];
      } else {
        let rawCode = codeBuf.join('\n');
        if (codeLang === 'mermaid') {
          // Dedent the diagram code (Mermaid is sensitive to leading whitespace from MD indentation)
          const lines = rawCode.split('\n');
          const nonEmpty = lines.filter(l => l.trim().length > 0);
          if (nonEmpty.length > 0) {
            const minIndent = Math.min(...nonEmpty.map(l => l.match(/^ */)[0].length));
            rawCode = lines.map(l => l.startsWith(' '.repeat(minIndent)) ? l.slice(minIndent) : l).join('\n').trim();
          }
          out.push(`<div class="mermaid">${rawCode}</div>`);
        } else {
          const code = escapeHtml(rawCode);
          const isDiagram = codeBuf.some(l => l.includes('┌') || l.includes('SITE') || l.includes('DC '));
          if (isDiagram) {
            out.push(`<div class="architecture-diagram"><pre><code>${code}</code></pre></div>`);
          } else {
            out.push(`<div class="code-wrapper"><pre><code>${code}</code></pre></div>`);
          }
        }
        inCode = false;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    if (line.trim().startsWith('|')) {
      closeList();
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(parseTable(tableLines));
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push('<hr class="my-6 border-zinc-200">');
      i++;
      continue;
    }

    const h4 = line.match(/^#### (.+)$/);
    const h3 = line.match(/^### (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h1 = line.match(/^# (.+)$/);

    if (h1 || h2 || h3 || h4) {
      closeList();
      const text = (h1 || h2 || h3 || h4)[1];
      const level = h1 ? 1 : h2 ? 2 : h3 ? 3 : 4;
      const id = slugify(text.replace(/^\d+\.\s*/, ''));
      const tag = `h${level}`;
      const anchor = level <= 2 ? ` <a href="#${id}" class="section-anchor"><i class="fa-solid fa-link text-sm"></i></a>` : '';
      out.push(`<${tag} id="${id}">${inlineMd(text)}${anchor}</${tag}>`);
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      closeList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      const quoteText = quoteLines.join(' ');
      const cls = /gotcha|critical|capacity note/i.test(quoteText) ? 'gotcha' : 'best-practice';
      const label = quoteText.match(/^\*\*([^*]+?)\*\*:?\s*/);
      const body = label ? quoteText.slice(label[0].length) : quoteText;
      const labelText = label ? label[1].replace(/:+\s*$/, '') : '';
      const labelHtml = label ? `<strong>${escapeHtml(labelText)}:</strong> ` : '';
      out.push(`<div class="${cls}"><p>${labelHtml}${inlineMd(body)}</p></div>`);
      continue;
    }

    const ulMatch = line.match(/^- (.+)$/);
    const olMatch = line.match(/^\d+\. (.+)$/);

    if (ulMatch && isChecklistItem(line)) {
      if (!inList || !checklist) {
        closeList();
        out.push('<ul class="checklist">');
        inList = true;
        listType = 'ul';
        checklist = true;
      }
      const checked = /^- \[x\] /i.test(line);
      const text = line.replace(/^- \[[ x]\] /i, '');
      let itemHtml = inlineMd(text);
      i++;
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
        const nestedCode = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          nestedCode.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        itemHtml += `<div class="code-wrapper mt-2"><pre><code>${escapeHtml(nestedCode.join('\n'))}</code></pre></div>`;
      }
      out.push(`<li><input type="checkbox"${checked ? ' checked' : ''} class="mt-1"><span>${itemHtml}</span></li>`);
      continue;
    }

    if (ulMatch) {
      if (!inList || checklist || listType !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listType = 'ul';
        checklist = false;
      }
      out.push(`<li>${inlineMd(ulMatch[1])}</li>`);
      i++;
      continue;
    }

    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listType = 'ol';
        checklist = false;
      }
      let itemHtml = inlineMd(olMatch[1]);
      i++;
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
        const nestedCode = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          nestedCode.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        itemHtml += `<div class="code-wrapper mt-2"><pre><code>${escapeHtml(nestedCode.join('\n'))}</code></pre></div>`;
      }
      out.push(`<li>${itemHtml}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      i++;
      continue;
    }

    closeList();
    const para = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (
        next.trim() === '' ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        next.startsWith('|') ||
        next.startsWith('> ') ||
        next.match(/^- /) ||
        next.match(/^\d+\. /) ||
        /^---+$/.test(next.trim())
      ) break;
      para.push(next);
      i++;
    }
    out.push(`<p>${inlineMd(para.join(' '))}</p>`);
  }

  closeList();
  return out.join('\n');
}


module.exports={slugify,escapeHtml,inlineMd,parseTable,isChecklistItem,convertMdToHtml};
