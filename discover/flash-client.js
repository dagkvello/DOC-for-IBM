/**
 * IBM Storage Virtualize / FlashSystem REST client (Node.js, zero npm deps).
 *
 * Auth: POST /rest/auth (or /rest/v1/auth) with X-Auth-Username / X-Auth-Password
 * Commands: POST /rest/<cmd> (or /rest/v1/<cmd>) with X-Auth-Token
 *
 * TLS: self-signed certs accepted when insecure: true (lab default).
 */
const https = require('https');
const { URL } = require('url');

class FlashClient {
  /**
   * @param {object} opts
   * @param {string} opts.host - hostname or IP
   * @param {string} opts.username
   * @param {string} opts.password
   * @param {number} [opts.port=7443]
   * @param {boolean} [opts.insecure=true]
   * @param {number} [opts.timeoutMs=60000]
   * @param {'auto'|'v1'|'legacy'} [opts.apiStyle='auto']
   */
  constructor(opts) {
    this.host = opts.host;
    this.port = opts.port || 7443;
    this.username = opts.username;
    this.password = opts.password;
    this.insecure = opts.insecure !== false;
    this.timeoutMs = opts.timeoutMs || 60000;
    this.apiStyle = opts.apiStyle || 'auto';
    this.token = null;
    this.basePath = null; // '/rest' or '/rest/v1'
    this.label = opts.label || opts.host;
  }

  _request(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`https://${this.host}:${this.port}${path}`);
      const payload = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
      const reqHeaders = {
        Accept: 'application/json',
        ...headers,
      };
      if (payload != null) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers: reqHeaders,
          rejectUnauthorized: !this.insecure,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let json = null;
            if (raw && raw.trim()) {
              try {
                json = JSON.parse(raw);
              } catch {
                json = { _raw: raw };
              }
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: json,
              raw,
            });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout connecting to ${this.host}:${this.port}`));
      });
      if (payload != null) req.write(payload);
      req.end();
    });
  }

  async login() {
    const styles =
      this.apiStyle === 'v1'
        ? ['/rest/v1']
        : this.apiStyle === 'legacy'
          ? ['/rest']
          : ['/rest/v1', '/rest'];

    let lastErr = null;
    for (const base of styles) {
      try {
        const res = await this._request(
          'POST',
          `${base}/auth`,
          {
            'X-Auth-Username': this.username,
            'X-Auth-Password': this.password,
          },
          {}
        );
        if (res.status >= 200 && res.status < 300) {
          const token =
            (res.body && (res.body.token || res.body.Token)) ||
            res.headers['x-auth-token'] ||
            res.headers['X-Auth-Token'];
          if (!token) {
            lastErr = new Error(`Auth OK but no token in response (${base}/auth)`);
            continue;
          }
          this.token = token;
          this.basePath = base;
          return { basePath: base, token: '***' };
        }
        lastErr = new Error(`Auth failed ${res.status} on ${base}/auth: ${res.raw?.slice(0, 200)}`);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Authentication failed');
  }

  /**
   * Run a Storage Virtualize CLI-style REST command.
   * @param {string} command e.g. 'lssystem', 'lsvdisk'
   * @param {object} [params] JSON body parameters (filtervalue, etc.)
   */
  async cmd(command, params = {}) {
    if (!this.token || !this.basePath) await this.login();
    const path = `${this.basePath}/${command.replace(/^\//, '')}`;
    const res = await this._request(
      'POST',
      path,
      { 'X-Auth-Token': this.token },
      params && Object.keys(params).length ? params : {}
    );
    if (res.status === 401 || res.status === 403) {
      // token expired — re-auth once
      await this.login();
      const res2 = await this._request(
        'POST',
        path,
        { 'X-Auth-Token': this.token },
        params && Object.keys(params).length ? params : {}
      );
      if (res2.status < 200 || res2.status >= 300) {
        throw new Error(`${command} failed ${res2.status}: ${res2.raw?.slice(0, 300)}`);
      }
      return normalizeCmdResult(res2.body);
    }
    if (res.status < 200 || res.status >= 300) {
      // some code levels return empty body on empty lists
      if (res.status === 404) return [];
      throw new Error(`${command} failed ${res.status} on ${this.host}: ${res.raw?.slice(0, 300)}`);
    }
    return normalizeCmdResult(res.body);
  }
}

/** Normalize REST body to array or object. */
function normalizeCmdResult(body) {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (typeof body === 'object') {
    // single object (lssystem) or error envelope
    if (body.errors || body.error) return body;
    return body;
  }
  return body;
}

/**
 * Safe cmd that returns [] on known "not supported" / empty failures.
 */
async function softCmd(client, command, params) {
  try {
    return await client.cmd(command, params);
  } catch (e) {
    const msg = String(e.message || e);
    if (/failed 404|CMMVC|not supported|Unknown command/i.test(msg)) {
      return [];
    }
    throw e;
  }
}

module.exports = { FlashClient, softCmd, normalizeCmdResult };
