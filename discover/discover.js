#!/usr/bin/env node
/**
 * Discover IBM FlashSystem inventory (standalone or multi-system Flash Grid).
 * Writes config.yaml + inventory.yaml for build-wiki.js.
 *
 *   node discover/discover.js --mock
 *   node discover/discover.js --host 10.1.1.1 --user u --pass p
 *   node discover/discover.js --host a --host b --host c --user u --pass p
 *   node discover/discover.js --hosts a,b,c --user u --pass p --write-generated
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { loadYamlFile } = require('../lib/load-yaml');
const { collectLive, loadSnapshot } = require('./collect');
const { mapDiscovery } = require('./map-to-yaml');
const { emitDocument } = require('./yaml-emit');

function parseArgs(argv) {
  const args = {
    hosts: [],
    user: process.env.FS_USER || null,
    pass: process.env.FS_PASS || null,
    port: parseInt(process.env.FS_PORT || '7443', 10),
    insecure: true,
    mock: false,
    dryRun: false,
    dumpJson: null,
    jsonFiles: [],
    outConfig: path.join(ROOT, 'config.yaml'),
    outInventory: path.join(ROOT, 'inventory.yaml'),
    overrides: path.join(ROOT, 'config.overrides.yaml'),
    noOverrides: false,
    writeGenerated: false,
    help: false,
  };

  // Env multi-host: FS_HOSTS=ip1,ip2
  if (process.env.FS_HOSTS) {
    args.hosts.push(...process.env.FS_HOSTS.split(/[,;\s]+/).filter(Boolean));
  }
  if (process.env.FS_HOST) args.hosts.push(process.env.FS_HOST);

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--host':
        args.hosts.push(next());
        break;
      case '--hosts':
        args.hosts.push(...String(next()).split(/[,;\s]+/).filter(Boolean));
        break;
      case '--user':
      case '-u':
        args.user = next();
        break;
      case '--pass':
      case '-p':
        args.pass = next();
        break;
      case '--port':
        args.port = parseInt(next(), 10);
        break;
      case '--insecure':
        args.insecure = true;
        break;
      case '--secure':
        args.insecure = false;
        break;
      case '--mock':
        args.mock = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--dump-json':
        args.dumpJson = next();
        break;
      case '--json':
        args.jsonFiles.push(next());
        break;
      case '--out-config':
        args.outConfig = path.resolve(next());
        break;
      case '--out-inventory':
        args.outInventory = path.resolve(next());
        break;
      case '--overrides':
        args.overrides = path.resolve(next());
        break;
      case '--no-overrides':
        args.noOverrides = true;
        break;
      case '--write-generated':
        args.writeGenerated = true;
        break;
      default:
        console.error('Unknown argument:', a);
        args.help = true;
    }
  }
  // Dedupe hosts
  args.hosts = [...new Set(args.hosts.filter(Boolean))];
  return args;
}

function usage() {
  console.log(`Usage: node discover/discover.js [options]

Document IBM FlashSystem systems (standalone or Flash Grid members).

Hosts:
  --host <ip>            Add a system (repeatable)
  --hosts <a,b,c>        Comma-separated list
  Env: FS_HOST, FS_HOSTS, FS_USER, FS_PASS, FS_PORT

Auth:
  --user / --pass        REST credentials (monitor role OK)
  --port                 Default 7443
  --insecure | --secure  TLS (default: accept self-signed)

Offline:
  --mock                 Use discover/fixtures (2-system grid demo)
  --json <file>          Load snapshot JSON (repeatable)

Output:
  --dry-run              Print YAML only
  --dump-json <dir>      Save raw snapshots
  --write-generated      Write *.generated.yaml (safe)
  --overrides <path>     Default config.overrides.yaml
  --no-overrides

Then:  node build-wiki.js
`);
}

async function loadSnapshots(args) {
  if (args.mock) {
    const dir = path.join(__dirname, 'fixtures');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) throw new Error('No fixtures in discover/fixtures');
    return {
      snaps: files.map((f) => loadSnapshot(path.join(dir, f))),
      mode: 'mock',
    };
  }

  if (args.jsonFiles.length) {
    return {
      snaps: args.jsonFiles.map((f) => loadSnapshot(path.resolve(f))),
      mode: 'json',
    };
  }

  if (!args.hosts.length) {
    throw new Error('Provide --host / --hosts, or --mock / --json. See --help.');
  }
  if (!args.user || !args.pass) {
    throw new Error('Provide --user and --pass (or FS_USER / FS_PASS).');
  }

  const snaps = [];
  for (const host of args.hosts) {
    console.error(`Connecting ${host}:${args.port} ...`);
    const snap = await collectLive({
      host,
      port: args.port,
      username: args.user,
      password: args.pass,
      insecure: args.insecure,
      label: host,
    });
    console.error(
      `  OK name=${snap.commands.lssystem ? 'yes' : 'no'} errors=${snap.errors.length}`
    );
    snaps.push(snap);
  }
  return { snaps, mode: 'live' };
}

function loadOverrides(args) {
  if (args.noOverrides) return {};
  if (!args.overrides || !fs.existsSync(args.overrides)) {
    console.error('No overrides file (skipping):', args.overrides || '(none)');
    return {};
  }
  return loadYamlFile(args.overrides);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (args.writeGenerated) {
    args.outConfig = path.join(ROOT, 'config.generated.yaml');
    args.outInventory = path.join(ROOT, 'inventory.generated.yaml');
  }

  const { snaps, mode } = await loadSnapshots(args);

  if (args.dumpJson) {
    const dir = path.resolve(args.dumpJson);
    fs.mkdirSync(dir, { recursive: true });
    snaps.forEach((s, i) => {
      const name = (s.commands?.lssystem && (Array.isArray(s.commands.lssystem) ? s.commands.lssystem[0]?.name : s.commands.lssystem?.name)) || s.host || `system${i + 1}`;
      const safe = String(name).replace(/[^\w.-]+/g, '_');
      const p = path.join(dir, `${safe}-snapshot.json`);
      fs.writeFileSync(p, JSON.stringify(s, null, 2));
      console.error('Wrote', p);
    });
  }

  const overrides = loadOverrides(args);
  const mapped = mapDiscovery(snaps, overrides);

  const configYaml = emitDocument(mapped.config, [
    '# Generated by discover/discover.js — IBM FlashSystem documentation.',
    `# Source mode: ${mode}`,
    `# Systems: ${mapped.meta.system_count}`,
    `# Discovered: ${mapped.meta.discovered_at}`,
    '# Human fields merged from config.overrides.yaml when present.',
  ]);

  const inventoryYaml = emitDocument(mapped.inventory, [
    '# Generated inventory — systems, pools, hosts, volumes, partitions.',
    `# Source mode: ${mode}`,
    `# systems=${mapped.meta.system_count}`,
  ]);

  console.error('--- discovery summary ---');
  console.error(JSON.stringify(mapped.meta, null, 2));

  if (args.dryRun) {
    console.log('===== config.yaml =====');
    console.log(configYaml);
    console.log('===== inventory.yaml =====');
    console.log(inventoryYaml);
    return;
  }

  fs.writeFileSync(args.outConfig, configYaml, 'utf8');
  fs.writeFileSync(args.outInventory, inventoryYaml, 'utf8');
  console.error('Wrote', path.relative(process.cwd(), args.outConfig));
  console.error('Wrote', path.relative(process.cwd(), args.outInventory));
  console.error('Next: node build-wiki.js');
  if (args.writeGenerated) {
    console.error('     (uses *.generated.yaml automatically if config.yaml is missing)');
    console.error('  or: node build-wiki.js --generated');
    console.error('  or: node build-wiki.js --promote   # copy generated → config.yaml then build');
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
