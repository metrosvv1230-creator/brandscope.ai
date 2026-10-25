// Pure parsing: HTML metadata, logo, imagery, and CSS colour / font / radius analysis. No network here, so it can be tested offline.

/* ---------------- small HTML helpers ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', middot: '·', copy: '©', reg: '®', trade: '™' };
export function decode(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export function attrs(tag) {
  const o = {};
  tag.replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g, (m, k, _v, a, b, c) => { o[k.toLowerCase()] = decode(a ?? b ?? c ?? ''); return m; });
  return o;
}
const stripTags = (s) => decode(String(s).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function abs(u, base) { if (!u) return null; const v = u.trim(); if (!v || v.startsWith('data:') || v.startsWith('javascript:') || v.startsWith('#')) return null; try { const r = new URL(v, base); return /^https?:$/.test(r.protocol) ? r.href : null; } catch { return null; } }
function bestFromSrcset(ss, base) {
  if (!ss) return null;
  let best = null, bw = -1;
  for (const part of ss.split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
    if (w > bw) { bw = w; best = u; }
  }
  return abs(best, base);
}

/* ---------------- HTML ---------------- */
export function parseHtml(html, pageUrl) {
  const base = (() => { const m = html.match(/<base\b[^>]*>/i); const h = m && attrs(m[0]).href; try { return h ? new URL(h, pageUrl).href : pageUrl; } catch { return pageUrl; } })();
  const metas = (html.match(/<meta\b[^>]*>/gi) || []).map(attrs);
  const meta = (...keys) => { for (const k of keys) { const f = metas.find(m => (m.property || m.name || '').toLowerCase() === k && m.content); if (f) return f.content.trim(); } return ''; };
  const links = (html.match(/<link\b[^>]*>/gi) || []).map(attrs);
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');

  const domain = new URL(pageUrl).hostname.replace(/^www\./, '');
  const domainWord = domain.split('.')[0].toLowerCase();
  const siteName = meta('og:site_name', 'application-name', 'apple-mobile-web-app-title');
  const nameFromTitle = (() => {
    const parts = title.split(/\s+[|–—\-:·•]\s+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    const hit = parts.find(p => p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(domainWord.replace(/[^a-z0-9]/g, '')));
    return (hit || (parts.length > 1 ? parts[parts.length - 1] : parts[0])).slice(0, 40);
  })();
  const name = (siteName || nameFromTitle || domainWord).trim();

  const h1 = stripTags((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const subheads = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => stripTags(m[1])).filter(t => t.length > 3 && t.length < 90).slice(0, 4);

  // icons
  const iconLinks = links.filter(l => /icon/i.test(l.rel || '') && l.href);
  const sizeOf = (l) => { const m = (l.sizes || '').match(/(\d+)x(\d+)/); return m ? +m[1] : (/apple-touch/i.test(l.rel) ? 180 : /\.svg/i.test(l.href) ? 512 : 32); };
  iconLinks.sort((a, b) => sizeOf(b) - sizeOf(a));
  const icon = iconLinks.length ? abs(iconLinks[0].href, base) : abs('/favicon.ico', base);
  const manifest = abs((links.find(l => /manifest/i.test(l.rel || '')) || {}).href, base);

  // stylesheets (rel=stylesheet, or preloaded styles)
  const sheets = links.filter(l => l.href && (/stylesheet/i.test(l.rel || '') || (/preload/i.test(l.rel || '') && l.as === 'style'))).map(l => abs(l.href, base)).filter(Boolean);
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const styleAttrs = [...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map(m => decode(m[2] ?? m[3] ?? '')).slice(0, 400);

  // logo
  const logo = findLogo(html, base, name);
  let logo2 = findLogo(html, base, name, 'footer');
  if (logo2 && logo && ((logo2.svg && logo2.svg === logo.svg) || (logo2.src && logo2.src === logo.src))) logo2 = null;

  // imagery
  const images = [];
  const seen = new Set();
  const push = (u, w = 0, alt = '') => { if (u && !seen.has(u) && !/\.svg(\?|$)/i.test(u)) { seen.add(u); images.push({ src: u, w, alt }); } };
  push(abs(meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), base), 1200, 'Share image');
  const SKIP = /(logo|icon|sprite|pixel|avatar|badge|flag|spinner|loader|placeholder|blank|tracking|1x1|emoji|payment|rating|star)/i;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const src = bestFromSrcset(a.srcset || a['data-srcset'], base) || abs(a['data-src'] || a['data-lazy-src'] || a.src, base);
    if (!src) continue;
    const w = parseInt(a.width || '0', 10), h = parseInt(a.height || '0', 10);
    if ((w && w < 160) || (h && h < 120)) continue;
    if (SKIP.test(src) || SKIP.test(a.alt || '') || SKIP.test(a.class || '')) continue;
    push(src, w, a.alt || '');
    if (images.length >= 10) break;
  }
  for (const m of html.matchAll(/<source\b[^>]*>/gi)) { if (images.length >= 10) break; const a = attrs(m[0]); if (/image/i.test(a.type || 'image')) push(bestFromSrcset(a.srcset, base), 0, ''); }

  return {
    base, domain, name, title, description: meta('og:description', 'description', 'twitter:description'),
    headline: h1, subheads, themeColor: meta('theme-color'), icon, manifest, sheets: [...new Set(sheets)].slice(0, 10),
    inlineCss, styleAttrs, logo, logo2, images: images.slice(0, 8)
  };
}

function cleanSvg(svg) {
  let s = svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
  if (!/xmlns=/.test(s)) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}
function findLogo(html, base, name, region = 'top') {
  const lim = Math.max(20000, Math.floor(html.length * 0.45));
  let head = html.slice(0, lim);
  if (region === 'footer') {
    const f = html.search(/<footer\b/i);
    head = f >= 0 ? html.slice(f) : html.slice(Math.floor(html.length * 0.7));
  }
  const nameKey = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // 1) inline SVG near a logo/brand/home hint
  for (const m of head.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svg = m[0];
    if (svg.length < 100 || svg.length > 80000) continue;
    if (/<use\b/i.test(svg) && !/<path\b/i.test(svg)) continue;
    const before = head.slice(Math.max(0, m.index - 400), m.index).toLowerCase();
    const tag = svg.slice(0, 400).toLowerCase();
    const hint = /logo|brand|wordmark|logotype|site-title|navbar-brand|home/.test(tag) || /(class|id|aria-label)=["'][^"']*(logo|brand|wordmark|home)[^"']*["'][^<]*$/.test(before) || (nameKey && tag.replace(/[^a-z0-9]/g, '').includes(nameKey));
    if (hint) return { type: 'svg', svg: cleanSvg(svg) };
  }
  // 2) <img> that says logo
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const blob = `${a.src || ''} ${a.alt || ''} ${a.class || ''} ${a.id || ''}`.toLowerCase();
    if (/logo|brand|wordmark/.test(blob) || (nameKey && (a.alt || '').toLowerCase().replace(/[^a-z0-9]/g, '') === nameKey)) {
      const src = bestFromSrcset(a.srcset, base) || abs(a['data-src'] || a.src, base);
      if (src) return { type: 'img', src };
    }
  }
  return null;
}

/* ---------------- colours ---------------- */
const NAMED = { white: '#ffffff', black: '#000000' };
function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
function toHex(r, g, b) { return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function hslToRgb(h, s, l) { h = ((h % 360) + 360) % 360 / 360; const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
export function parseColor(tok) {
  const t = tok.trim().toLowerCase();
  if (NAMED[t]) return { hex: NAMED[t], a: 1 };
  let m = t.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { hex: '#' + h.slice(0, 6), a };
  }
  m = t.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) { const v = (x) => x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x); const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1; return { hex: toHex(v(m[1]), v(m[2]), v(m[3])), a }; }
  m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) { const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100); const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1; return { hex: toHex(r, g, b), a }; }
  return null;
}
export function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function hslOf(hex) {
  let [r, g, b] = rgbOf(hex).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [Math.round(h), s, l];
}
const isNeutral = (hex) => { const [, s, l] = hslOf(hex); return s < 0.14 || l > 0.96 || l < 0.07; };
const dist = (a, b) => { const x = rgbOf(a), y = rgbOf(b); return Math.sqrt((x[0] - y[0]) ** 2 * .3 + (x[1] - y[1]) ** 2 * .59 + (x[2] - y[2]) ** 2 * .11); };
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g;

/* ---------------- CSS ---------------- */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset', 'revert', 'emoji', 'math', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'android emoji', 'emojisymbols']);
const COMMON = new Set(['arial', 'helvetica', 'helvetica neue', 'segoe ui', 'roboto', 'ubuntu', 'cantarell', 'oxygen', 'oxygen-sans', 'fira sans', 'droid sans', 'noto sans', 'liberation sans', 'tahoma', 'verdana', 'times new roman', 'times', 'georgia', 'courier new', 'courier', 'sf pro text', 'sf pro display', 'menlo', 'monaco', 'consolas']);
const unq = (s) => s.trim().replace(/^["']|["']$/g, '').trim();

export function analyseCss(sources, { themeColor = '', styleAttrs = [] } = {}) {
  const vars = new Map();
  const colorW = new Map();
  const fontCount = new Map();
  const faces = [];
  const radii = new Map();
  const roles = { buttonBg: new Map(), buttonText: new Map(), buttonRadius: new Map(), bodyBg: new Map(), bodyText: new Map(), headingFont: new Map(), bodyFont: new Map(), linkColor: new Map() };
  const bump = (map, k, w = 1) => { if (k) map.set(k, (map.get(k) || 0) + w); };
  const rules = [];

  for (const { css, base } of sources) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(); const body = m[2];
      const decls = [];
      for (const d of body.split(';')) { const i = d.indexOf(':'); if (i > 0) decls.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim()]); }
      if (/^@font-face/i.test(sel)) {
        const get = (k) => (decls.find(d => d[0] === k) || [])[1] || '';
        const fam = unq(get('font-family'));
        const srcs = [...get('src').matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)\s*(?:format\(\s*["']?([\w-]+)["']?\s*\))?/gi)].map(x => ({ url: x[2], fmt: (x[3] || x[2].split('?')[0].split('.').pop() || '').toLowerCase() }));
        const pick = srcs.find(s => s.fmt.includes('woff2')) || srcs.find(s => s.fmt.includes('woff')) || srcs.find(s => /truetype|ttf|opentype|otf/.test(s.fmt));
        if (fam && pick && !pick.url.startsWith('data:')) {
          let u = null; try { u = new URL(pick.url, base).href; } catch {}
          if (u) faces.push({ family: fam, weight: (get('font-weight') || '400').trim(), style: (get('font-style') || 'normal').trim(), src: u, format: pick.fmt.includes('woff2') ? 'woff2' : pick.fmt.includes('woff') ? 'woff' : /otf|opentype/.test(pick.fmt) ? 'opentype' : 'truetype', unicodeRange: get('unicode-range') });
        }
        continue;
      }
      if (sel.startsWith('@')) continue;
      rules.push([sel, decls]);
      for (const [p, v] of decls) if (p.startsWith('--')) { if (!vars.has(p) || /:root|html/.test(sel)) vars.set(p, v); }
    }
  }
  for (const s of styleAttrs) {
    const decls = []; for (const d of s.split(';')) { const i = d.indexOf(':'); if (i > 0) decls.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]); }
    rules.push(['[style]', decls]);
  }

  const resolve = (v, depth = 0) => depth > 6 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name, fb) => { const r = vars.get(name); return r !== undefined ? resolve(r, depth + 1) : (fb || ''); });
  const colorsIn = (v) => (resolve(v).match(COLOR_RE) || []).map(parseColor).filter(c => c && c.a >= 0.5).map(c => c.hex);
  const PROPW = { 'background-color': 1.6, background: 1.4, color: 1, fill: 1.2, stroke: .6, 'border-color': .5, border: .5, 'border-top': .3, 'border-bottom': .3, 'outline-color': .3, 'text-decoration-color': .3, 'accent-color': 2 };

  // custom properties that look like brand colours count extra
  for (const [name, v] of vars) {
    const cs = colorsIn(v); if (!cs.length) continue;
    const w = /primary|brand|accent|main|secondary|highlight|cta|action/.test(name) ? 8 : /bg|background|surface|text|fg|foreground|neutral|gray|grey|border|shadow/.test(name) ? 1 : 2.5;
    bump(colorW, cs[0], w);
  }
  const BTN = /(^|[\s,>+~.#\[-])(btn|button|cta)(?![\w-]*(close|icon|reset|link|toggle|nav))/i;
  const HEAD = /(^|[\s,])h[12](?![\w-])|heading|headline|display|title|hero/i;
  const BODY = /^(html|body|:root)(\s*,\s*(html|body|:root))*$/i;
  for (const [sel, decls] of rules) {
    const isBtn = BTN.test(sel) && !/:(disabled|hover|focus|active)/.test(sel);
    const isBody = BODY.test(sel.trim());
    const isHead = HEAD.test(sel);
    const isLink = /(^|[\s,])a(\s*[,{:]|$)/.test(sel) && !/:hover/.test(sel);
    for (const [p, raw] of decls) {
      if (p.startsWith('--')) continue;
      const v = resolve(raw);
      if (p in PROPW) {
        const cs = colorsIn(raw);
        for (const c of cs) bump(colorW, c, PROPW[p]);
        if (cs.length) {
          if (isBtn && (p === 'background-color' || p === 'background')) bump(roles.buttonBg, cs[0], 3);
          if (isBtn && p === 'color') bump(roles.buttonText, cs[0]);
          if (isBody && (p === 'background-color' || p === 'background')) bump(roles.bodyBg, cs[0], 5);
          if (isBody && p === 'color') bump(roles.bodyText, cs[0], 5);
          if (isLink && p === 'color') bump(roles.linkColor, cs[0], 2);
        }
      }
      if (p === 'font-family' || p === 'font') {
        const fam = p === 'font' ? (v.match(/(?:\d[\w.%]*\s*(?:\/\s*[\w.%]+)?\s+)(.+)$/) || [])[1] : v;
        if (!fam) continue;
        const list = fam.split(',').map(unq).filter(Boolean);
        const real = list.find(f => !GENERIC.has(f.toLowerCase()) && !f.startsWith('var('));
        if (real) {
          bump(fontCount, real);
          if (isHead) bump(roles.headingFont, real, 3);
          if (isBody) bump(roles.bodyFont, real, 6);
        }
      }
      if (p === 'border-radius') {
        const n = v.match(/^([\d.]+)(px|rem|em)\b/);
        if (n) { const px = Math.round(parseFloat(n[1]) * (n[2] === 'px' ? 1 : 16)); if (px > 0 && px < 1000) { bump(radii, px); if (isBtn) bump(roles.buttonRadius, px, 3); } }
        else if (/^50%|^9999|^100(0|vh|vw)/.test(v) && isBtn) bump(roles.buttonRadius, 999, 3);
      }
    }
  }
  if (themeColor) { const c = parseColor(themeColor); if (c) bump(colorW, c.hex, 6); }

  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  // cluster colours
  const clusters = [];
  for (const [hex, w] of [...colorW.entries()].sort((a, b) => b[1] - a[1])) {
    const c = clusters.find(k => dist(k.hex, hex) < 26);
    if (c) c.w += w; else clusters.push({ hex, w });
  }
  clusters.sort((a, b) => b.w - a.w);
  const brand = clusters.filter(c => !isNeutral(c.hex));
  const neutrals = clusters.filter(c => isNeutral(c.hex));

  const theme = themeColor && parseColor(themeColor);
  const btnBg = top(roles.buttonBg).find(h => !isNeutral(h));
  let primary = (theme && !isNeutral(theme.hex) && theme.hex) || btnBg || (brand[0] && brand[0].hex) || null;
  const ordered = [];
  const add = (hex, role) => { if (hex && !ordered.some(o => dist(o.hex, hex) < 26)) ordered.push({ hex, role }); };
  add(primary, 'Primary');
  for (const c of brand) { if (ordered.length >= 4) break; add(c.hex, ordered.length === 1 ? 'Secondary' : 'Accent'); }

  const bg = top(roles.bodyBg)[0] || (neutrals.slice().sort((a, b) => hslOf(b.hex)[2] - hslOf(a.hex)[2])[0] || {}).hex || '#ffffff';
  const ink = top(roles.bodyText)[0] || (neutrals.slice().sort((a, b) => hslOf(a.hex)[2] - hslOf(b.hex)[2])[0] || {}).hex || '#111111';
  const neutralList = [];
  const addN = (hex, role) => { if (hex && !neutralList.some(o => dist(o.hex, hex) < 20) && !ordered.some(o => dist(o.hex, hex) < 20)) neutralList.push({ hex, role }); };
  addN(ink, 'Ink'); addN(bg, 'Paper');
  for (const n of neutrals) { if (neutralList.length >= 4) break; addN(n.hex, 'Neutral'); }
  if (!primary) { primary = ink; }

  // fonts
  const pickFont = (map) => { const t = top(map); return t.find(f => !COMMON.has(f.toLowerCase())) || t[0] || null; };
  const allFonts = top(fontCount);
  const faceFams = new Set(faces.map(f => f.family.toLowerCase()));
  const custom = allFonts.filter(f => faceFams.has(f.toLowerCase()));
  const headingFont = pickFont(roles.headingFont) || custom[0] || allFonts[0] || null;
  const bodyFont = pickFont(roles.bodyFont) || custom.find(f => f !== headingFont) || custom[0] || allFonts.find(f => f !== headingFont) || headingFont;

  const facesFor = (fam) => {
    if (!fam) return [];
    const list = faces.filter(f => f.family.toLowerCase() === fam.toLowerCase() && (f.style === 'normal' || !f.style));
    const latin = list.filter(f => !f.unicodeRange || /U\+0+-00?FF|U\+0000-00FF|U\+0-FF/i.test(f.unicodeRange) || /U\+0?0?20/i.test(f.unicodeRange));
    const pool = latin.length ? latin : list;
    const byW = new Map();
    for (const f of pool) { const w = String(f.weight).split(/\s+/)[0]; if (!byW.has(w)) byW.set(w, f); }
    const want = ['400', '500', '600', '700', '800', '300', 'normal', 'bold'];
    const chosen = []; for (const w of want) { if (byW.has(w)) chosen.push(byW.get(w)); if (chosen.length >= 3) break; }
    if (!chosen.length && pool[0]) chosen.push(pool[0]);
    return chosen;
  };
  const weightsOf = (fam) => [...new Set(faces.filter(f => fam && f.family.toLowerCase() === fam.toLowerCase()).map(f => String(f.weight).split(/\s+/)[0]))].slice(0, 6);
  const sourceOf = (fam, googleFams) => !fam ? 'system' : googleFams.has(fam.toLowerCase()) ? 'Google Fonts' : faceFams.has(fam.toLowerCase()) ? 'Custom web font' : COMMON.has(fam.toLowerCase()) ? 'System font' : 'Web font';

  const radius = top(roles.buttonRadius)[0] ?? top(radii)[0] ?? 8;
  const btnText = top(roles.buttonText)[0] || null;

  return {
    colors: { primary, palette: ordered, neutrals: neutralList, background: bg, text: ink, link: top(roles.linkColor)[0] || null },
    fonts: { heading: headingFont, body: bodyFont, all: allFonts.slice(0, 6), facesHeading: facesFor(headingFont), facesBody: bodyFont === headingFont ? [] : facesFor(bodyFont), weightsHeading: weightsOf(headingFont), weightsBody: weightsOf(bodyFont), sourceOf },
    ui: { radius: Math.min(radius, 999), buttonBg: btnBg || primary, buttonText: btnText }
  };
}
