// GET /api/asset?url=...  ->  streams a public image or font through this site, so the board can be exported as PNG/PDF
// without cross-origin errors. Only images and fonts are passed through, and they are served with a locked-down policy.
import { safeFetch, normaliseInput, UserError } from '../lib/net.mjs';

const FONT_EXT = /\.(woff2?|ttf|otf)(\?|#|$)/i;
const LOCKED = {
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin'
};

export default async (req) => {
  const raw = new URL(req.url).searchParams.get('url');
  try {
    const target = normaliseInput(raw);
    const isFont = FONT_EXT.test(target.pathname);
    const r = await safeFetch(target, {
      accept: isFont ? 'font/woff2,font/woff,*/*;q=0.5' : 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8',
      maxBytes: 8_000_000, timeout: 9_000, truncate: false
    });
    if (!r.res.ok) return new Response('Not found', { status: 404, headers: LOCKED });
    let type = r.type.split(';')[0].trim();
    const okImage = type.startsWith('image/');
    const okFont = type.startsWith('font/') || /font|woff|opentype|truetype/.test(type) || (isFont && /octet-stream|^$|text\/plain/.test(type));
    if (!okImage && !okFont) return new Response('Only images and fonts can be loaded', { status: 415, headers: LOCKED });
    if (okFont && !type.startsWith('font/')) {
      const ext = (target.pathname.match(FONT_EXT) || [])[1]?.toLowerCase();
      type = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf';
    }
    return new Response(r.body, { status: 200, headers: { ...LOCKED, 'content-type': type, 'cache-control': 'public, max-age=86400' } });
  } catch (e) {
    return new Response(e instanceof UserError ? e.message : 'Could not load that file', { status: 400, headers: LOCKED });
  }
};

export const config = { path: '/api/asset' };
