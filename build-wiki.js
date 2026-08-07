#!/usr/bin/env node
/**
 * DOC-for-IBM wiki builder
 *
 *   node build-wiki.js
 *   node build-wiki.js --generated
 *   node build-wiki.js --lint
 *
 * Assembles templates + config + inventory → out/FS_Documentation.md|html
 *
 * YAML resolution (first match wins per file):
 *   1. --config / --inventory paths if given
 *   2. --generated → config.generated.yaml + inventory.generated.yaml
 *   3. config.yaml / inventory.yaml if present
 *   4. else *.generated.yaml (so discover --write-generated works without a copy step)
 *
 * Always merges config.overrides.yaml on top of the loaded config/inventory
 * (customer name, author, notes, inventory annotations) unless --no-overrides.
 */
const fs = require('fs');
const path = require('path');
const {
  slugify,
  escapeHtml,
  inlineMd,
  convertMdToHtml,
} = require('./md-convert');
const { loadYamlFile } = require('./lib/load-yaml');
const { buildTokens, applyTokens } = require('./lib/tokens');
const { buildInventoryMarkdown, applyInventoryMarkers } = require('./lib/inventory-md');
const { expandFile } = require('./lib/expand');
const { mergeConfig, mergeInventory } = require('./discover/map-to-yaml');

const ROOT = __dirname;
const ASSEMBLY = path.join(ROOT, 'templates', 'plan.md');
const OUT_DIR = path.join(ROOT, 'out');
const OUT_BASE = 'FS_Documentation';

const PATHS = {
  config: path.join(ROOT, 'config.yaml'),
  inventory: path.join(ROOT, 'inventory.yaml'),
  configGenerated: path.join(ROOT, 'config.generated.yaml'),
  inventoryGenerated: path.join(ROOT, 'inventory.generated.yaml'),
  overrides: path.join(ROOT, 'config.overrides.yaml'),
};

function parseArgs(argv) {
  const args = {
    lint: false,
    help: false,
    generated: false,
    promote: false,
    noOverrides: false,
    overrides: null,
    config: null,
    inventory: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lint') args.lint = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--generated' || a === '-g') args.generated = true;
    else if (a === '--promote') args.promote = true;
    else if (a === '--no-overrides') args.noOverrides = true;
    else if (a === '--overrides') args.overrides = path.resolve(next());
    else if (a === '--config') args.config = path.resolve(next());
    else if (a === '--inventory') args.inventory = path.resolve(next());
    else {
      console.error('Unknown argument:', a);
      args.help = true;
    }
  }
  return args;
}

function usage() {
  console.log(`Usage: node build-wiki.js [options]

  (default) Build wiki using config.yaml + inventory.yaml when present,
            otherwise config.generated.yaml + inventory.generated.yaml.
            Always merges config.overrides.yaml (customer, author, notes, …).

  --generated, -g   Force use of *.generated.yaml from discover --write-generated
  --promote         Copy *.generated.yaml → config.yaml / inventory.yaml, then build
  --overrides PATH  Overrides file (default: config.overrides.yaml)
  --no-overrides    Do not merge overrides
  --config <path>   Explicit config YAML
  --inventory <path> Explicit inventory YAML
  --lint            Check sections / unresolved tokens
  --help            Show help
`);
}

/**
 * Load and split overrides: top-level config fields vs nested inventory: block.
 */
function loadOverrides(args) {
  if (args.noOverrides) return { config: {}, inventory: {} };
  const overridesPath = args.overrides || PATHS.overrides;
  if (!fs.existsSync(overridesPath)) {
    console.error('No overrides file (skipping):', path.relative(process.cwd(), overridesPath));
    return { config: {}, inventory: {} };
  }
  const raw = loadYamlFile(overridesPath);
  const inventory = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
  const config = { ...raw };
  delete config.inventory;
  console.error('Using overrides:', path.relative(process.cwd(), overridesPath));
  return { config, inventory };
}

/**
 * Resolve which config/inventory files to load.
 */
function resolveYamlPaths(args) {
  if (args.promote) {
    if (!fs.existsSync(PATHS.configGenerated) || !fs.existsSync(PATHS.inventoryGenerated)) {
      throw new Error(
        '--promote requires config.generated.yaml and inventory.generated.yaml (run discover first)'
      );
    }
    fs.copyFileSync(PATHS.configGenerated, PATHS.config);
    fs.copyFileSync(PATHS.inventoryGenerated, PATHS.inventory);
    console.error('Promoted generated YAML → config.yaml + inventory.yaml');
  }

  let configPath = args.config;
  let inventoryPath = args.inventory;

  if (args.generated) {
    configPath = configPath || PATHS.configGenerated;
    inventoryPath = inventoryPath || PATHS.inventoryGenerated;
  } else {
    if (!configPath) {
      if (fs.existsSync(PATHS.config)) configPath = PATHS.config;
      else if (fs.existsSync(PATHS.configGenerated)) configPath = PATHS.configGenerated;
      else configPath = PATHS.config;
    }
    if (!inventoryPath) {
      if (fs.existsSync(PATHS.inventory)) inventoryPath = PATHS.inventory;
      else if (fs.existsSync(PATHS.inventoryGenerated)) inventoryPath = PATHS.inventoryGenerated;
      else inventoryPath = PATHS.inventory;
    }
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config not found: ${path.relative(process.cwd(), configPath)}\n` +
        `Run: node discover/discover.js ...  (or --write-generated then build-wiki.js --generated)`
    );
  }
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(
      `Inventory not found: ${path.relative(process.cwd(), inventoryPath)}\n` +
        `Run: node discover/discover.js ...`
    );
  }

  return { configPath, inventoryPath };
}

function parseFrontmatter(source) {
  const items = [];
  for (let line of source.split('\n')) {
    line = line.trim();
    if (line.startsWith('# ')) continue;
    if (line === '---') break;
    if (line.startsWith('<!--')) continue;
    const match = line.match(/^\*\*([^:]+):\*\*\s*(.+)$/);
    if (match) items.push({ key: match[1].trim(), value: match[2].trim() });
  }
  return items;
}

function buildIntroHtml(metadata) {
  if (!metadata.length) return '';
  let html = `<div class="intro-metadata mb-6 p-4 bg-white border border-zinc-200 rounded-xl">
  <div class="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-3">Document Information</div>
  <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
`;
  for (const item of metadata) {
    html += `    <div><dt class="font-medium text-zinc-700">${escapeHtml(item.key)}</dt><dd class="text-zinc-600">${inlineMd(item.value)}</dd></div>\n`;
  }
  html += `  </dl>\n</div>`;
  return html;
}

function buildToc(bodyMd) {
  const items = [];
  let inCode = false;
  for (const line of bodyMd.split('\n')) {
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const h2 = line.match(/^## (.+)$/);
    if (!h2) continue;
    const text = h2[1].trim();
    const id = slugify(text.replace(/^\d+\.\s*/, ''));
    let icon = 'fa-circle';
    if (/overview/i.test(text)) icon = 'fa-file-lines';
    else if (/system/i.test(text)) icon = 'fa-server';
    else if (/capacity|pool/i.test(text)) icon = 'fa-database';
    else if (/host/i.test(text)) icon = 'fa-desktop';
    else if (/volume/i.test(text)) icon = 'fa-hard-drive';
    else if (/partition/i.test(text)) icon = 'fa-layer-group';
    else if (/connect|replicat/i.test(text)) icon = 'fa-network-wired';
    else if (/append/i.test(text)) icon = 'fa-book';
    items.push({ id, label: text, icon });
  }
  items.push({ id: 'appendices-source', label: 'Source Markdown', icon: 'fa-file-code' });
  return items;
}

function lintPlan(md, inventory) {
  const errors = [];
  const warnings = [];
  const required = [
    /## 1\.\s*Overview/i,
    /## 2\.\s*Systems/i,
    /## 3\.\s*Capacity/i,
    /## 4\.\s*Hosts/i,
    /## 5\.\s*Volumes/i,
    /## 6\.\s*Storage partitions|## 6\.\s*Partitions/i,
    /## 7\.\s*Connectivity/i,
    /## 8\.\s*Appendices/i,
  ];
  for (const re of required) {
    if (!re.test(md)) errors.push(`Missing required section matching ${re}`);
  }
  if (!(inventory.systems && inventory.systems.length)) {
    warnings.push('inventory.yaml has no systems');
  }
  const unresolved = [...md.matchAll(/\{\{([a-zA-Z0-9_.]+)\}\}/g)].map((m) => m[1]);
  if (unresolved.length) errors.push(`Unresolved tokens: ${[...new Set(unresolved)].join(', ')}`);
  return { ok: errors.length === 0, errors, warnings };
}

function assembleMarkdown(configPath, inventoryPath, args = {}) {
  console.error('Using config:   ', path.relative(process.cwd(), configPath));
  console.error('Using inventory:', path.relative(process.cwd(), inventoryPath));

  let config = loadYamlFile(configPath);
  let inventory = loadYamlFile(inventoryPath);

  const ov = loadOverrides(args);
  if (ov.config && Object.keys(ov.config).length) {
    config = mergeConfig(config, ov.config);
  }
  if (ov.inventory && Object.keys(ov.inventory).length) {
    inventory = mergeInventory(inventory, ov.inventory);
  }

  const tokens = buildTokens(config);

  let md = expandFile(ASSEMBLY);
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  const inv = buildInventoryMarkdown(config, inventory);
  md = applyInventoryMarkers(md, inv);
  md = applyTokens(md, tokens);

  return { md, config, inventory, inv, tokens };
}

function renderWikiHtml({ md, config, inv, tokens }) {
  const metadata = parseFrontmatter(md);
  let bodyMd = md;
  const start = md.match(/##\s*1\.\s*Overview/i);
  if (start) bodyMd = md.substring(md.indexOf(start[0]));

  const introHtml = buildIntroHtml(metadata);
  const contentHtml = convertMdToHtml(bodyMd);
  const embeddedMd = escapeHtml(md);
  const tocItems = buildToc(bodyMd);
  const tocHtml = tocItems
    .map(
      (item) =>
        `<a href="#${item.id}" class="toc-link flex items-center gap-x-2 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100 rounded-md text-sm">
                        <i class="fa-solid ${item.icon} w-4"></i>
                        <span>${escapeHtml(item.label)}</span>
                    </a>`
    )
    .join('\n                    ');

  const qa = [];
  const find = (re) => tocItems.find((t) => re.test(t.label));
  const sys = find(/system/i);
  const hosts = find(/host/i);
  const vols = find(/volume/i);
  if (sys)
    qa.push({ id: sys.id, icon: 'fa-server', label: 'Systems', cls: 'bg-sky-50 hover:bg-sky-100 text-sky-800' });
  if (hosts)
    qa.push({ id: hosts.id, icon: 'fa-desktop', label: 'Hosts', cls: 'bg-violet-50 hover:bg-violet-100 text-violet-800' });
  if (vols)
    qa.push({ id: vols.id, icon: 'fa-hard-drive', label: 'Volumes', cls: 'bg-amber-50 hover:bg-amber-100 text-amber-800' });
  const quickActionsHtml = qa
    .map(
      (q) =>
        `<button type="button" onclick="document.getElementById('${q.id}')?.scrollIntoView({behavior:'smooth'})"
                                class="w-full text-left text-xs px-3 py-1.5 ${q.cls} rounded flex items-center gap-x-2">
                            <i class="fa-solid ${q.icon}"></i> <span>${q.label}</span>
                        </button>`
    )
    .join('\n                        ');

  const version = tokens.doc_version;
  const codeLevel = tokens.code_level || tokens.code_levels;
  const customer = tokens['customer.name'];
  const author = tokens.author;
  const grid = tokens['grid.name'] || tokens['scope.label'];
  const title = tokens.title;
  const subtitle = tokens.subtitle;
  const deployment = tokens.deployment;
  const stats = inv.stats;
  const versionJson = JSON.stringify(version);
  const deployBadge =
    deployment === 'flash_grid'
      ? 'bg-indigo-100 text-indigo-800'
      : deployment === 'partnership'
        ? 'bg-amber-100 text-amber-900'
        : deployment === 'multi_system'
          ? 'bg-violet-100 text-violet-800'
          : deployment === 'grid_member'
            ? 'bg-sky-100 text-sky-800'
            : 'bg-emerald-100 text-emerald-800';
  const deployLabel = tokens.deployment_label || deployment || 'Standalone';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} • ${escapeHtml(customer)}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap');
        :root { --ibm-blue: #0f62fe; }
        body { font-family: 'Inter', system-ui, sans-serif; }
        .wiki-content h1 {
            font-size: 2.25rem; line-height: 2.5rem; font-weight: 700; color: #161616;
            border-bottom: 3px solid #0f62fe; padding-bottom: 0.5rem; margin-top: 2rem; margin-bottom: 1rem;
        }
        .wiki-content h2 {
            font-size: 1.5rem; line-height: 2rem; font-weight: 600; color: #161616;
            margin-top: 2.25rem; margin-bottom: 0.75rem; padding-bottom: 0.25rem; border-bottom: 1px solid #e5e7eb;
        }
        .wiki-content h3 { font-size: 1.125rem; font-weight: 600; color: #262626; margin-top: 1.5rem; margin-bottom: 0.5rem; }
        .wiki-content h4 { font-weight: 600; color: #404040; margin-top: 1.15rem; margin-bottom: 0.4rem; }
        .wiki-content p { margin-bottom: 1rem; color: #262626; line-height: 1.7; }
        .wiki-content ul, .wiki-content ol { margin-bottom: 1rem; padding-left: 1.25rem; }
        .wiki-content li { margin-bottom: 0.35rem; color: #262626; line-height: 1.55; }
        .wiki-content .table-scroll {
            width: 100%; overflow-x: auto; margin: 1.1rem 0 1.35rem;
            border: 1px solid #d1d5db; border-radius: 10px;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 14px rgba(15, 23, 42, 0.04);
            background: #fff;
        }
        .wiki-content table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; min-width: 560px; font-size: 0.875rem; }
        .wiki-content th {
            background: linear-gradient(180deg, #f4f4f4 0%, #ebebeb 100%);
            color: #161616; font-weight: 600; text-align: left; padding: 0.7rem 0.9rem;
            border-bottom: 2px solid #c6c6c6; font-size: 0.78rem; white-space: nowrap;
        }
        .wiki-content th.col-first { background: linear-gradient(180deg, #e8f1ff 0%, #d9e8ff 100%); color: #002d9c; }
        .wiki-content td { padding: 0.65rem 0.9rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size: 0.875rem; color: #262626; line-height: 1.45; }
        .wiki-content td.col-first { font-weight: 600; color: #161616; background: #fafbff; }
        .wiki-content tbody tr:nth-child(even) td { background-color: #fafafa; }
        .wiki-content tbody tr:nth-child(even) td.col-first { background: #f3f6fb; }
        .wiki-content tbody tr:hover td { background-color: #f0f7ff !important; }
        .wiki-content tbody tr:last-child td { border-bottom: none; }
        .wiki-content code {
            background-color: #eef2ff; color: #1e3a8a; padding: 0.12rem 0.45rem; border-radius: 4px;
            font-size: 0.82em; font-family: 'JetBrains Mono', ui-monospace, monospace; border: 1px solid #e0e7ff;
        }
        .wiki-content pre {
            background-color: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 8px;
            overflow-x: auto; margin: 1rem 0; border: 1px solid #374151;
        }
        .wiki-content pre code { background: transparent; color: inherit; padding: 0; border: none; font-size: 0.875rem; line-height: 1.5; }
        .section-anchor { color: #0f62fe; text-decoration: none; margin-left: 0.5rem; opacity: 0; transition: opacity 0.2s; }
        h1:hover .section-anchor, h2:hover .section-anchor, h3:hover .section-anchor { opacity: 1; }
        .nav-active { background-color: #e0e7ff; color: #1e40af; font-weight: 600; border-radius: 4px; }
        .toc-link { transition: all 0.1s ease; }
        .toc-link:hover { color: #0f62fe; transform: translateX(2px); }
        .copy-btn { position: absolute; top: 8px; right: 8px; background: #374151; color: #e5e7eb; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.7rem; cursor: pointer; opacity: 0.85; z-index: 2; }
        .copy-btn:hover { background: #4b5563; opacity: 1; }
        .code-wrapper { position: relative; }
        .dr-header { background: linear-gradient(90deg, #0f62fe 0%, #0043ce 55%, #1e3a8a 100%); }
        .metric { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.55rem 0.85rem; min-width: 4.75rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        .intro-metadata { box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05); }
        .intro-metadata dt { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280 !important; }
        .intro-metadata dd { margin-top: 0.15rem; color: #262626 !important; }
        .highlight { background-color: #fef08c; padding: 1px 3px; border-radius: 2px; }
        .mermaid { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 1rem; margin: 1.25rem 0; }
        @media print {
          .no-print { display: none !important; }
          aside { display: none !important; }
          pre { white-space: pre-wrap; }
          .wiki-content .table-scroll { box-shadow: none; overflow: visible; }
          .wiki-content table { min-width: 0; }
        }
    </style>
</head>
<body class="bg-zinc-50 text-zinc-900">
    <header class="dr-header text-white sticky top-0 z-50 shadow-lg no-print">
        <div class="max-w-screen-2xl mx-auto">
            <div class="px-6 py-3 flex items-center justify-between flex-wrap gap-y-2">
                <div class="flex items-center gap-x-3">
                    <div class="flex items-center gap-x-2">
                        <i class="fa-solid fa-database text-3xl"></i>
                        <div>
                            <span class="font-semibold text-xl tracking-tight">IBM Storage</span>
                            <span class="text-blue-200 text-sm block -mt-1">FlashSystem</span>
                        </div>
                    </div>
                    <div class="ml-2 pl-2 border-l border-blue-400">
                        <h1 class="text-2xl font-semibold tracking-tighter">${escapeHtml(title)}</h1>
                        <p class="text-blue-200 text-xs -mt-0.5">${escapeHtml(subtitle)} • OS ${escapeHtml(codeLevel)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-x-3 text-sm flex-wrap">
                    <div class="flex items-center gap-x-2 bg-white/10 px-3 py-1 rounded-full text-xs">
                        <i class="fa-solid fa-sitemap"></i>
                        <span>${escapeHtml(grid || '—')}</span>
                    </div>
                    <div class="px-3 py-1 bg-indigo-500/90 text-white rounded-full text-xs font-medium flex items-center gap-x-1.5">
                        <i class="fa-solid fa-microchip"></i>
                        <span>OS ${escapeHtml(codeLevel)}</span>
                    </div>
                    <div class="px-3 py-1 bg-emerald-500/90 text-white rounded-full text-xs font-medium flex items-center gap-x-1.5">
                        <i class="fa-solid fa-check-circle"></i>
                        <span>v${escapeHtml(version)} • Inventory</span>
                    </div>
                    <div class="px-3 py-1 bg-white/10 text-blue-100 rounded-full text-xs font-medium flex items-center gap-x-1.5">
                        <i class="fa-solid fa-user"></i>
                        <span>${escapeHtml(author)}</span>
                    </div>
                    <div class="px-3 py-1 bg-white/10 text-white rounded-full text-xs font-medium flex items-center gap-x-1.5">
                        <i class="fa-solid fa-building"></i>
                        <span><strong>${escapeHtml(customer)}</strong></span>
                    </div>
                    <button type="button" onclick="window.print()" class="flex items-center gap-x-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 transition rounded-lg text-sm font-medium">
                        <i class="fa-solid fa-print"></i><span>Print / PDF</span>
                    </button>
                    <button type="button" onclick="copyMarkdownSource()" class="flex items-center gap-x-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 transition rounded-lg text-sm font-medium">
                        <i class="fa-solid fa-file-export"></i><span>Copy MD</span>
                    </button>
                </div>
            </div>
        </div>
    </header>

    <div class="max-w-screen-2xl mx-auto flex">
        <aside class="w-72 hidden xl:block bg-white border-r border-zinc-200 h-[calc(100vh-57px)] sticky top-[57px] overflow-y-auto no-print p-4 text-sm">
            <div class="px-2 pb-3">
                <div class="uppercase text-[10px] font-semibold tracking-wider text-zinc-500 mb-2 px-2">Contents</div>
                <nav class="space-y-0.5">${tocHtml}</nav>
                <div class="mt-6 px-2">
                    <div class="text-[10px] uppercase font-semibold tracking-wider text-zinc-500 mb-1.5">Quick Actions</div>
                    <div class="space-y-1">${quickActionsHtml}</div>
                </div>
            </div>
        </aside>

        <main class="flex-1 max-w-5xl px-6 py-8 wiki-content">
            <div class="mb-8 flex flex-wrap items-center gap-3">
                <div>
                    <div class="flex items-center gap-x-2 flex-wrap gap-y-1">
                        <span class="px-2.5 py-0.5 text-xs font-semibold bg-sky-100 text-sky-800 rounded">DOC-for-IBM</span>
                        <span class="px-2.5 py-0.5 text-xs font-semibold ${deployBadge} rounded">${escapeHtml(deployLabel)}</span>
                        <span class="px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded">v${escapeHtml(version)}</span>
                        <span class="px-2.5 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-800 rounded">OS ${escapeHtml(codeLevel)}</span>
                        <span class="px-2.5 py-0.5 text-xs font-semibold bg-violet-100 text-violet-800 rounded">${stats.systemCount || 0} system(s)</span>
                    </div>
                    <p class="text-sm text-zinc-500 mt-1">
                        <strong class="text-zinc-700">Class:</strong> <span class="font-medium">${escapeHtml(deployLabel)}</span>
                        &nbsp;•&nbsp;
                        <strong class="text-zinc-700">Scope:</strong>
                        <span class="font-medium font-mono">${escapeHtml(grid || tokens['scope.members'] || '—')}</span>
                        &nbsp;•&nbsp;
                        <strong class="text-zinc-700">Primary:</strong>
                        <span class="font-medium font-mono">${escapeHtml(tokens['system.array_id'])}</span>
                        <span class="text-zinc-400"> (${escapeHtml(tokens['system.model'])})</span>
                    </p>
                </div>
                <div class="ml-auto flex items-center gap-2 text-xs flex-wrap">
                    <div class="metric"><span class="font-semibold text-indigo-600">Systems</span><br><span class="font-mono text-base font-semibold">${escapeHtml(String(stats.systemCount || tokens['metrics.systems']))}</span></div>
                    <div class="metric"><span class="font-semibold text-emerald-600">Hosts</span><br><span class="font-mono text-base font-semibold">${escapeHtml(String(stats.hostCount || tokens['metrics.hosts']))}</span></div>
                    <div class="metric"><span class="font-semibold text-amber-600">Volumes</span><br><span class="font-mono text-base font-semibold">${escapeHtml(String(stats.volumeCount || tokens['metrics.volumes']))}</span></div>
                    <div class="metric"><span class="font-semibold text-sky-600">Pools</span><br><span class="font-mono text-base font-semibold">${escapeHtml(String(stats.poolCount || tokens['metrics.pools']))}</span></div>
                </div>
            </div>

            <div class="p-4 bg-white border border-zinc-200 rounded-xl mb-6">
                <div class="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-1">As-built inventory</div>
                <div class="text-lg font-semibold text-zinc-800">${escapeHtml(title)}</div>
                <p class="text-sm text-zinc-600 mt-1">Live configuration documentation for <strong>${escapeHtml(customer)}</strong>. Re-run discovery after array changes, then rebuild this wiki.</p>
            </div>

            ${introHtml}
            ${contentHtml}

            <h2 id="appendices-source">Source Markdown</h2>
            <details>
                <summary class="cursor-pointer select-none bg-zinc-100 hover:bg-zinc-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-x-2 border border-zinc-200">
                    <i class="fa-solid fa-file-code"></i>
                    <span>Expanded Markdown (after includes + inventory)</span>
                </summary>
                <div class="mt-3 border border-zinc-300 rounded-xl overflow-hidden">
                    <div class="bg-zinc-800 text-zinc-300 px-3 py-1 text-xs flex items-center justify-between">
                        <span>${OUT_BASE}.md</span>
                        <button type="button" onclick="copyFullMarkdownFromDetails()" class="text-[10px] px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded">Copy All MD</button>
                    </div>
                    <pre class="m-0 p-4 text-xs overflow-auto max-h-[480px] bg-zinc-950 text-emerald-300" style="font-family:'JetBrains Mono',ui-monospace,monospace;white-space:pre;line-height:1.35;"><code>${embeddedMd}</code></pre>
                </div>
            </details>

            <div class="mt-10 border-t pt-6 text-xs text-zinc-500 flex flex-wrap gap-x-6 gap-y-1">
                <div><strong>Author:</strong> ${escapeHtml(author)}</div>
                <div><strong>Document Version:</strong> v${escapeHtml(version)}</div>
                <div><strong>Storage Virtualize:</strong> ${escapeHtml(codeLevel)}</div>
                <div><strong>Date:</strong> ${escapeHtml(tokens.date)}</div>
            </div>
            <p class="mt-4 text-xs text-zinc-400">DOC-for-IBM — edit <code>config.overrides.yaml</code>, re-run <code>node discover/discover.js</code>, then <code>node build-wiki.js</code>.</p>
        </main>
    </div>

    <footer class="bg-white border-t text-xs text-zinc-500 py-3 px-6 no-print max-w-screen-2xl mx-auto">
        <div class="flex justify-between items-center text-[11px] flex-wrap gap-2">
            <div>FlashSystem inventory wiki from discovery. Print to PDF for offline use.</div>
            <div class="font-medium">IBM FlashSystem • ${escapeHtml(deployLabel)} • ${escapeHtml(codeLevel)}</div>
        </div>
    </footer>

    <script>
        function addCopyButtons() {
            document.querySelectorAll('.wiki-content pre').forEach(block => {
                let wrapper = block.parentElement;
                if (!wrapper.classList.contains('code-wrapper')) {
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 'code-wrapper';
                    block.parentNode.insertBefore(newWrapper, block);
                    newWrapper.appendChild(block);
                    wrapper = newWrapper;
                }
                if (wrapper.querySelector('.copy-btn')) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'copy-btn';
                btn.innerHTML = '<i class="fa-solid fa-copy mr-1"></i> Copy';
                btn.onclick = () => {
                    const code = block.querySelector('code') ? block.querySelector('code').innerText : block.innerText;
                    navigator.clipboard.writeText(code.trim()).then(() => {
                        btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Copied!';
                        btn.style.background = '#166534';
                        setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy mr-1"></i> Copy'; btn.style.background = '#374151'; }, 1800);
                    });
                };
                wrapper.style.position = 'relative';
                wrapper.appendChild(btn);
            });
        }
        function setupSmoothScroll() {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function(e) {
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) {
                        e.preventDefault();
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        target.classList.add('highlight');
                        setTimeout(() => target.classList.remove('highlight'), 1400);
                    }
                });
            });
        }
        function copyMarkdownSource() {
            const embeddedPre = document.querySelector('details pre code');
            const mdText = embeddedPre ? embeddedPre.innerText.trim() : '';
            navigator.clipboard.writeText(mdText).then(() => {
                const toast = document.createElement('div');
                toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 bg-emerald-700 text-white text-xs px-4 py-2 rounded-full shadow-lg z-[999] no-print';
                toast.textContent = 'Full Markdown copied!';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 1600);
            });
        }
        function copyFullMarkdownFromDetails() { copyMarkdownSource(); }
        function setupTocHighlight() {
            const tocLinks = document.querySelectorAll('.toc-link');
            const headings = document.querySelectorAll('.wiki-content h1, .wiki-content h2, .wiki-content h3');
            window.addEventListener('scroll', () => {
                let current = '';
                headings.forEach(h => { if (h.getBoundingClientRect().top <= 140) current = h.getAttribute('id'); });
                tocLinks.forEach(link => {
                    link.classList.remove('nav-active', 'font-medium');
                    if (link.getAttribute('href') === '#' + current) link.classList.add('nav-active', 'font-medium');
                });
            });
        }
        function init() {
            addCopyButtons();
            setupSmoothScroll();
            setupTocHighlight();
            if (typeof mermaid !== 'undefined') {
                mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
                setTimeout(() => { try { mermaid.run(); } catch (e) {} }, 50);
            }
            console.log('%c[DOC-for-IBM] Wiki v' + ${versionJson} + ' ready.', 'color:#64748b');
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    </script>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  let paths;
  try {
    paths = resolveYamlPaths(args);
  } catch (e) {
    console.error('ERROR:', e.message || e);
    process.exit(1);
  }

  const assembled = assembleMarkdown(paths.configPath, paths.inventoryPath, args);
  const lint = lintPlan(assembled.md, assembled.inventory);

  if (args.lint) {
    console.log(JSON.stringify(lint, null, 2));
    process.exit(lint.ok ? 0 : 1);
  }

  for (const w of lint.warnings) console.warn('⚠️', w);
  if (!lint.ok) {
    for (const e of lint.errors) console.error('❌', e);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mdOut = path.join(OUT_DIR, OUT_BASE + '.md');
  const htmlOut = path.join(OUT_DIR, OUT_BASE + '.html');
  fs.writeFileSync(mdOut, assembled.md, 'utf8');
  const html = renderWikiHtml(assembled);
  fs.writeFileSync(htmlOut, html, 'utf8');

  console.log('Wrote', path.relative(process.cwd(), mdOut));
  console.log('Wrote', path.relative(process.cwd(), htmlOut));
  console.log('Size HTML:', (html.length / 1024).toFixed(1), 'KB');
}

main();
