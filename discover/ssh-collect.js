#!/usr/bin/env node
/**
 * Collect FlashSystem inventory over SSH (CLI -json) when TCP 7443 is blocked.
 * Storage Virtualize SSH refuses port forwarding, so this runs lssystem and the
 * other inventory commands directly. Password comes from FS_PASS (never argv).
 *
 *   node discover/ssh-collect.js --hosts 10.1.1.1,10.2.2.2 --user monitor --dump-json discover/dump
 *
 * Writes the same snapshot shape as discover/collect.js. Feed the files to:
 *   node discover/discover.js --json <file> --json <file> --write-generated
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { COMMANDS } = require('./collect');

function usage() {
  console.log(`Usage: node discover/ssh-collect.js --user <user> [--dump-json <dir>] (--hosts <ip>[,<ip>...] | --prod <ip> --rec <ip>)

Password: environment variable FS_PASS.
Requires OpenSSH (ssh) and SSH_ASKPASS support (OpenSSH 8.4+).
--hosts names each snapshot from lssystem. --prod and --rec write prod-snapshot.json and rec-snapshot.json.
`);
}

function splitHosts(value) {
  return String(value || '').split(/[,;\s]+/).filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    targets: [],
    user: process.env.FS_USER || '',
    dumpJson: path.join(__dirname, 'dump'),
    help: false,
  };
  const add = (ips, role, file) => {
    for (const ip of ips) {
      args.targets.push({ ip, role: role || '', file: file || '' });
    }
  };
  if (process.env.FS_HOSTS) add(splitHosts(process.env.FS_HOSTS), '', '');
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--host':
        add([next()], '', '');
        break;
      case '--hosts':
        add(splitHosts(next()), '', '');
        break;
      case '--prod':
        add([next()], 'prod', 'prod-snapshot.json');
        break;
      case '--rec':
        add([next()], 'rec', 'rec-snapshot.json');
        break;
      case '--user':
      case '-u':
        args.user = next() || '';
        break;
      case '--dump-json':
        args.dumpJson = next();
        break;
      default:
        console.error('Unknown argument:', a);
        args.help = true;
    }
  }
  const seen = new Set();
  args.targets = args.targets.filter((t) => {
    if (!t.ip) return false;
    const key = `${t.role}:${t.ip}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return args;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseJson(text) {
  const s = String(text || '').replace(/^\uFEFF/, '').trim();
  const a = s.indexOf('[');
  const o = s.indexOf('{');
  let i = -1;
  if (a >= 0 && o >= 0) i = Math.min(a, o);
  else i = Math.max(a, o);
  if (i < 0) throw new Error(s.slice(0, 300) || 'empty output');
  const slice = s.slice(i);
  try {
    return JSON.parse(slice);
  } catch (e) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = 0; k < slice.length; k++) {
      const ch = slice[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return JSON.parse(slice.slice(0, k + 1));
      }
    }
    throw e;
  }
}

function systemName(lssystem, fallback) {
  const row = Array.isArray(lssystem) ? lssystem[0] : lssystem;
  const name = row && (row.name || row.id);
  return String(name || fallback).replace(/[^\w.-]+/g, '_');
}

function writeAskPass() {
  const ask = path.join(os.tmpdir(), `fs-askpass-${process.pid}.cmd`);
  const body = [
    '@echo off',
    'powershell.exe -NoProfile -Command "[Console]::OutputEncoding = New-Object System.Text.ASCIIEncoding; [Console]::Out.WriteLine($env:FS_PASS)"',
    '',
  ].join('\r\n');
  fs.writeFileSync(ask, body, 'ascii');
  return ask;
}

function sshJson(user, ip, command, env) {
  const r = spawnSync(
    'ssh',
    [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=30',
      '-o', 'NumberOfPasswordPrompts=1',
      '-o', 'PreferredAuthentications=password,keyboard-interactive',
      `${user}@${ip}`,
      `${command} -json`,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
      env,
    }
  );
  const err = String(r.stderr || '');
  const out = String(r.stdout || '');
  if (r.error) throw new Error(r.error.message);
  if (/Permission denied|Authentication failed|Too many authentication/i.test(err)) {
    throw new Error(`SSH authentication failed for ${ip}: ${err.slice(0, 400)}`);
  }
  if (r.status === 255) {
    throw new Error(`SSH failed for ${ip} (${command}): ${(err || out).slice(0, 400)}`);
  }
  return out;
}

function collectHost(user, ip, env) {
  const snap = {
    host: ip,
    label: ip,
    collected_at: new Date().toISOString(),
    commands: {},
    errors: [],
  };
  for (const cmd of COMMANDS) {
    process.stderr.write(`SSH ${ip} ${cmd} -json\n`);
    const out = sshJson(user, ip, cmd, env);
    try {
      snap.commands[cmd] = parseJson(out);
    } catch (e) {
      snap.errors.push({ command: cmd, error: String(e.message || e).slice(0, 300) });
      snap.commands[cmd] = [];
      process.stderr.write(`  skip ${cmd}: ${String(e.message || e).slice(0, 180)}\n`);
    }
    sleep(300);
  }
  const sys = snap.commands.lssystem;
  const empty = sys == null || (Array.isArray(sys) && sys.length === 0);
  if (empty) {
    throw new Error(`lssystem failed on ${ip}; snapshot not written`);
  }
  return snap;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.targets.length || !args.user) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!process.env.FS_PASS) {
    console.error('FS_PASS is not set.');
    process.exit(1);
  }

  const ask = writeAskPass();
  const env = {
    ...process.env,
    SSH_ASKPASS: ask,
    SSH_ASKPASS_REQUIRE: 'force',
    DISPLAY: '1',
  };
  const dir = path.resolve(args.dumpJson);
  fs.mkdirSync(dir, { recursive: true });
  const result = { snapshots: [], prod: null, rec: null };

  try {
    for (const target of args.targets) {
      const snap = collectHost(args.user, target.ip, env);
      if (target.role) snap.label = target.role;
      const file = target.file
        ? path.join(dir, target.file)
        : path.join(dir, `${systemName(snap.commands.lssystem, target.ip)}-snapshot.json`);
      fs.writeFileSync(file, JSON.stringify(snap, null, 2));
      result.snapshots.push(file);
      if (target.role === 'prod') result.prod = file;
      if (target.role === 'rec') result.rec = file;
      process.stderr.write(`Wrote ${file} commandErrors=${snap.errors.length}\n`);
    }
  } catch (e) {
    console.error(String(e.message || e));
    process.exitCode = 1;
    return;
  } finally {
    try { fs.unlinkSync(ask); } catch (_) { /* temp askpass */ }
  }

  console.log(JSON.stringify(result));
}

if (require.main === module) main();

module.exports = { parseJson, systemName };
