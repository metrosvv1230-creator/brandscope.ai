// Safe fetching for user-supplied URLs: public http(s) hosts only, redirects re-checked, size and time limits.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class UserError extends Error {}

function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return ipv4Private(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

export function normaliseInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new UserError('Paste a website address first.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new UserError('That doesn’t look like a web address. Try something like stripe.com.'); }
  if (!/^https?:$/.test(u.protocol)) throw new UserError('Only http and https addresses work.');
  if (!u.hostname.includes('.') || /^localhost$/i.test(u.hostname) || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) {
    throw new UserError('That address isn’t a public website.');
  }
  return u;
}

export async function assertPublic(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await lookup(host, { all: true }); }
    catch { throw new UserError('Couldn’t find that website. Check the spelling.'); }
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new UserError('That address isn’t a public website.');
}

async function readLimited(res, maxBytes, truncate) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      if (!truncate) throw new UserError('That file is too large.');
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      total = maxBytes;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function safeFetch(input, { accept = '*/*', maxBytes = 3_000_000, timeout = 10_000, truncate = true } = {}) {
  let current = input instanceof URL ? input : normaliseInput(input);
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:$/.test(current.protocol)) throw new UserError('Only http and https addresses work.');
    await assertPublic(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      let res;
      try {
        res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' } });
      } catch (e) {
        throw new UserError(e.name === 'AbortError' ? 'The website took too long to respond.' : 'Couldn’t reach that website.');
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current); continue; }
      const body = await readLimited(res, maxBytes, truncate);
      return { res, body, url: current.href, type: (res.headers.get('content-type') || '').toLowerCase() };
    } finally { clearTimeout(timer); }
  }
  throw new UserError('The website redirected too many times.');
}

export const text = (u8) => new TextDecoder('utf-8', { fatal: false }).decode(u8);
