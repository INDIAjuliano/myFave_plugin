// Accès aux favoris Chrome (sans DOM : utilisable aussi par le service worker)
export async function getBookmarks() {
  const [root] = await chrome.bookmarks.getTree();
  const out = [];
  (function walk(node, path) {
    for (const n of node.children || []) {
      if (n.url) {
        if (/^https?:/i.test(n.url)) {
          out.push({ id: n.id, title: n.title || '', url: n.url, folder: path[path.length - 1] || 'Favoris', path: path.join(' / '), added: n.dateAdded || 0, parentId: n.parentId, index: n.index });
        }
      } else walk(n, n.title ? [...path, n.title] : path);
    }
  })(root, []);
  return out;
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function faviconUrl(url, size = 32) {
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=${size}`;
}

// Recherche multi-mots : chaque mot doit apparaître dans le titre, l'URL ou le dossier
export function search(items, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...items].sort((a, b) => b.added - a.added);
  const scored = [];
  for (const b of items) {
    const title = b.title.toLowerCase(), dom = domainOf(b.url).toLowerCase(), hay = `${title} ${b.url.toLowerCase()} ${b.path.toLowerCase()}`;
    if (!tokens.every(t => hay.includes(t))) continue;
    let s = 0;
    for (const t of tokens) s += title.startsWith(t) ? 3 : title.includes(t) ? 2 : dom.includes(t) ? 1.5 : 1;
    scored.push([s, b]);
  }
  return scored.sort((x, y) => y[0] - x[0] || y[1].added - x[1].added).map(x => x[1]);
}

// Se met à jour dès qu'un favori est ajouté, modifié, déplacé ou supprimé
export function watch(cb) {
  let t;
  const fire = () => { clearTimeout(t); t = setTimeout(cb, 150); };
  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onImportEnded']) chrome.bookmarks[ev].addListener(fire);
}

// ---------- Gestion (édition, déplacement, suppression) ----------
export async function getFolders() {
  const [root] = await chrome.bookmarks.getTree();
  const out = [];
  (function walk(node, path, parentId = null) {
    for (const c of node.children || []) {
      if (c.url) continue;
      const p = [...path, c.title];
      out.push({ id: c.id, title: c.title, path: p.join(' / '), parentId: parentId || c.parentId });
      walk(c, p, c.id);
    }
  })(root, []);
  return out;
}
export const removeMany = ids => Promise.all(ids.map(id => chrome.bookmarks.remove(id)));
export const moveMany = (ids, parentId) => Promise.all(ids.map(id => chrome.bookmarks.move(id, { parentId })));
export const updateOne = (id, changes) => chrome.bookmarks.update(id, changes);
export const createFolder = (title, parentId = '1') => chrome.bookmarks.create({ parentId, title });
// Annuler une suppression : recrée les favoris dans leur dossier d'origine, à leur position
export async function restore(items) {
  for (const b of [...items].sort((x, y) => x.index - y.index)) {
    const base = { parentId: b.parentId, title: b.title, url: b.url };
    try { await chrome.bookmarks.create({ ...base, index: b.index }); }
    catch { try { await chrome.bookmarks.create(base); } catch {} }
  }
}
