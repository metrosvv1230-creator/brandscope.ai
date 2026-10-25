// GET /api/extract?url=example.com  ->  JSON with the site's logo, colours, fonts, UI style, copy and imagery.
// Kept under Netlify's 10-second function limit: page 6 s, stylesheets in parallel up to ~8.5 s, manifest only if time allows.
import { safeFetch, normaliseInput, text, UserError } from '../lib/net.mjs';
import { parseHtml, analyseCss } from '../lib/extract-core.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=900' : 'no-store' }
});

export default async (req) => {
  const started = Date.now();
  const raw = new URL(req.url).searchParams.get('url');
  try {
    const target = normaliseInput(raw);
    const page = await safeFetch(target, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', maxBytes: 2_500_000, timeout: 6_000 });
    if (!page.res.ok) throw new UserError(`The website answered with an error (${page.res.status}). Some sites block automated visits.`);
    if (page.type && !/html|xml|text\/plain/.test(page.type)) throw new UserError('That address isn’t a web page.');
    const html = text(page.body);
    const info = parseHtml(html, page.url);

    // stylesheets, in parallel, with one level of @import
    const budget = { bytes: 0 };
    const getCss = async (u) => {
      if (budget.bytes > 5_000_000) return null;
      try {
        const r = await safeFetch(new URL(u), { accept: 'text/css,*/*;q=0.1', maxBytes: 1_500_000, timeout: Math.max(1_000, Math.min(4_000, 8_500 - (Date.now() - started))) });
        if (!r.res.ok) return null;
        budget.bytes += r.body.length;
        return { css: text(r.body), base: r.url };
      } catch { return null; }
    };
    const first = (await Promise.all(info.sheets.map(getCss))).filter(Boolean);
    const imports = [];
    for (const s of first) for (const m of s.css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi)) { try { imports.push(new URL(m[1], s.base).href); } catch {} }
    const inlineImports = [...info.inlineCss.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi)].map(m => { try { return new URL(m[1], info.base).href; } catch { return null; } }).filter(Boolean);
    const second = Date.now() - started > 6_500 ? [] : (await Promise.all([...new Set([...imports, ...inlineImports])].slice(0, 6).map(getCss))).filter(Boolean);
    const sources = [...first, ...second, { css: info.inlineCss, base: info.base }];

    // web app manifest: name, theme colour, best icon
    let man = null;
    if (info.manifest && Date.now() - started < 7_500) {
      try { const r = await safeFetch(new URL(info.manifest), { accept: 'application/manifest+json,application/json', maxBytes: 200_000, timeout: 1_500 }); if (r.res.ok) man = JSON.parse(text(r.body)); } catch {}
    }
    const themeColor = info.themeColor || man?.theme_color || '';
    const a = analyseCss(sources, { themeColor, styleAttrs: info.styleAttrs });

    let icon = info.icon;
    if (man?.icons?.length) {
      const best = [...man.icons].sort((x, y) => parseInt(y.sizes || '0', 10) - parseInt(x.sizes || '0', 10))[0];
      try { if (best?.src && parseInt(best.sizes || '0', 10) >= 128) icon = new URL(best.src, info.manifest).href; } catch {}
    }

    const googleFams = new Set();
    for (const s of sources) if (/fonts\.googleapis\.com/.test(s.base)) for (const m of s.css.matchAll(/font-family:\s*['"]?([^;'"]+)/gi)) googleFams.add(m[1].trim().toLowerCase());
    const font = (fam, weights, faces) => fam ? { family: fam, source: a.fonts.sourceOf(fam, googleFams), weights, faces } : null;

    const out = {
      url: page.url,
      domain: info.domain,
      name: (man?.short_name && man.short_name.length <= 24 ? man.short_name : null) || info.name,
      title: info.title,
      description: info.description,
      headline: info.headline || info.subheads[0] || info.description || info.title,
      subheads: info.subheads,
      logo: info.logo,
      logo2: info.logo2,
      icon,
      images: info.images.map(i => i.src),
      colors: a.colors,
      fonts: { heading: font(a.fonts.heading, a.fonts.weightsHeading, a.fonts.facesHeading), body: font(a.fonts.body, a.fonts.weightsBody, a.fonts.facesBody), all: a.fonts.all },
      ui: a.ui,
      themeColor: themeColor || null,
      screenshot: `https://api.microlink.io/?url=${encodeURIComponent(page.url)}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1440&viewport.height=900&waitForTimeout=1500`,
      stats: { stylesheets: sources.length - 1, ms: Date.now() - started },
      extractedAt: new Date().toISOString()
    };
    return json(out);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'Something went wrong while reading that website. Try again, or try another address.';
    return json({ error: msg }, e instanceof UserError ? 400 : 500);
  }
};

export const config = { path: '/api/extract' };
