/**
 * Collect inventory snapshots from one or more FlashSystems.
 */
const fs = require('fs');
const path = require('path');
const { FlashClient, softCmd } = require('./flash-client');

/** Commands useful for standalone / grid documentation (not DR-focused). */
const COMMANDS = [
  'lssystem',
  'lsenclosure',
  'lsmdiskgrp',
  'lsmdisk',
  'lshost',
  'lshostcluster',
  'lsvdisk',
  'lsvolumegroup',
  'lspartition',
  'lspartnership',
  'lsreplicationpolicy',
  'lsportfc',
  'lsportip',
  'lsnode',
  'lsiogrp',
];

async function collectFromClient(client) {
  const snap = {
    host: client.host,
    label: client.label,
    collected_at: new Date().toISOString(),
    commands: {},
    errors: [],
  };

  await client.login();
  snap.api_base = client.basePath;

  for (const cmd of COMMANDS) {
    try {
      snap.commands[cmd] = await softCmd(client, cmd);
    } catch (e) {
      snap.errors.push({ command: cmd, error: String(e.message || e) });
      snap.commands[cmd] = null;
    }
  }

  return snap;
}

async function collectLive(conn) {
  const client = new FlashClient({
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    insecure: conn.insecure !== false,
    label: conn.label || conn.host,
    apiStyle: conn.apiStyle || 'auto',
  });
  return collectFromClient(client);
}

function loadSnapshot(filePath) {
  const abs = path.resolve(filePath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (data.commands) return data;
  return {
    host: data.host || path.basename(filePath),
    label: data.label || 'fixture',
    collected_at: data.collected_at || new Date().toISOString(),
    commands: data,
    errors: [],
  };
}

function asArray(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === 'object' && (x.errors || x.error)) return [];
  if (typeof x === 'object') return [x];
  return [];
}

function firstObject(x) {
  const a = asArray(x);
  return a[0] || (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
}

module.exports = {
  COMMANDS,
  collectFromClient,
  collectLive,
  loadSnapshot,
  asArray,
  firstObject,
};
