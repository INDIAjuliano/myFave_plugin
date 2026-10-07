// Aperçu des sites (image, description) lu directement depuis la page du favori.
// Rien n'est envoyé à un service tiers ; les résultats sont mis en cache localement.
const KEY = 'myfav_meta_v1', TTL = 7 * 864e5;
let cache = null, saveT;

const load = async () => (cache ??= (await chrome.storage.local.get(KEY))[KEY] || {});
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.local.set({ [KEY]: cache }), 600); };

export const hasAccess = () => chrome.permissions.contains({ origins: ['<all_urls>'] });
export const requestAccess = () => chrome.permissions.request({ origins: ['<all_urls>'] });
export const peek = async url => (await load())[url] || null;

const queue = [], inflight = new Map();
let running = 0;
function pump() {
  while (running < 4 && queue.length) { running++; queue.shift()().finally(() => { running--; pump(); }); }
}

export async function getMeta(url, { force = false } = {}) {
  const c = await load(), hit = c[url];
  if (hit && !force && Date.now() - hit.ts < TTL) return hit;
  if (inflight.has(url)) return inflight.get(url);
  const p = new Promise(res => { queue.push(() => fetchMeta(url).then(res)); pump(); });
  inflight.set(url, p);
  p.finally(() => inflight.delete(url));
  return p;
}

async function fetchMeta(url) {
  const m = { ts: Date.now(), img: null, desc: '', site: '' };
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { credentials: 'omit', signal: ctl.signal });
    clearTimeout(t);
    if (!(r.headers.get('content-type') || '').includes('html')) throw 0;
    const doc = new DOMParser().parseFromString((await r.text()).slice(0, 300000), 'text/html');
    const meta = s => doc.querySelector(s)?.getAttribute('content')?.trim() || '';
    const raw = meta('meta[property="og:image"]') || meta('meta[property="og:image:url"]') || meta('meta[name="twitter:image"]')
      || doc.querySelector('link[rel="image_src"]')?.getAttribute('href') || '';
    if (raw) { const u = new URL(raw, r.url || url); if (/^https?:$/.test(u.protocol)) m.img = u.href; }
    m.desc = (meta('meta[property="og:description"]') || meta('meta[name="description"]')).slice(0, 400);
    m.site = meta('meta[property="og:site_name"]');
  } catch {}
  (await load())[url] = m;
  save();
  return m;
}
