import { getBookmarks, getFolders, search, watch, domainOf, faviconUrl, removeMany, moveMany, updateOne, restore, createFolder } from './shared/data.js';
import { getMeta, peek, hasAccess, requestAccess } from './shared/meta.js';
import { icon, esc } from './shared/ui.js';
import { getTagList, setTags, getTags, addTag, removeTag } from './shared/tags.js';

const $ = id => document.getElementById(id);
const grid = $('grid'), q = $('search');
let all = [], folders = [], view = [], folder = 'all', category = 'all', selectedFolderId = null, sort = 'date-desc', selectedTag = null, canPreview = false;
let tagsCache = null;
let current = null, editing = null, lastPick = null, returnFocus = null;
const sel = new Set();
const byId = id => all.find(b => b.id === id);
const titleOf = b => b.title || domainOf(b.url);
const visit = b => chrome.tabs.create({ url: b.url, active: false });

async function ensureTags() {
  if (!tagsCache) tagsCache = await getTags();
  return tagsCache;
}

async function invalidateTags() {
  tagsCache = null;
}

/* ---------- Notification (avec « Annuler ») ---------- */
let toastT;
function toast(msg, act) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${act ? `<button id="toastAct">${act.label}</button>` : ''}`;
  t.classList.add('on');
  if (act) $('toastAct').onclick = () => { act.fn(); t.classList.remove('on'); };
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), act ? 9000 : 3000);
}

/* ---------- Cartes ---------- */
const card = b => `
  <article class="bookmark ${sel.has(b.id) ? 'sel' : ''}" tabindex="0" data-id="${b.id}">
    <button class="pick" tabindex="-1" aria-label="Sélectionner" aria-pressed="${sel.has(b.id)}">${icon('check')}</button>
    <div class="thumb" data-url="${esc(b.url)}"><img class="fav-big" src="${faviconUrl(b.url, 64)}" alt=""></div>
    <div class="body">
      <h3>${esc(titleOf(b))}</h3>
      <div class="url"><img class="fav" src="${faviconUrl(b.url, 16)}" alt=""><span>${esc(domainOf(b.url))}</span></div>
      <div class="bookmark-foot">
        <span class="folder">${icon('folder')}${esc(b.folder)}</span>
        <a class="open-link" tabindex="-1" href="${esc(b.url)}" target="_blank" rel="noopener">Visiter ${icon('arrow-up-right')}</a>
      </div>
    </div>
  </article>`;

function buildTree(query = '') {
  const tree = $('folderTree');
  const folderMap = new Map();
  const rootChildren = [];
  let bookmarksInFolder = [];

  folders.forEach(f => {
    folderMap.set(f.id, { folder: f, children: [], bookmarks: [] });
  });

  all.forEach(b => {
    if (!b.parentId) return;
    const node = folderMap.get(b.parentId);
    if (node) node.bookmarks.push(b);
  });

  folderMap.forEach((node, id) => {
    const parent = folderMap.get(node.folder.parentId);
    if (parent) parent.children.push(id);
    else rootChildren.push(id);
  });

  function matchesQuery(item, qText) {
    if (!qText) return true;
    const ql = qText.toLowerCase();
    if ((item.title || '').toLowerCase().includes(ql)) return true;
    if ((item.url || '').toLowerCase().includes(ql)) return true;
    if (item.folder && item.folder.toLowerCase().includes(ql)) return true;
    return false;
  }

  function renderNode(id, depth = 0) {
    const node = folderMap.get(id);
    if (!node) return '';
    const f = node.folder;
    const qText = query.trim();
    const folderMatch = !qText || f.title.toLowerCase().includes(qText.toLowerCase());
    const childMatches = node.children.some(cid => renderNode(cid, depth + 1).trim().length > 0);
    const bookmarkMatches = node.bookmarks.some(b => matchesQuery(b, qText));
    if (!folderMatch && !childMatches && !bookmarkMatches) return '';

    const hasChildren = node.children.length > 0;
    const hasBookmarks = node.bookmarks.length > 0;
    const isOpen = selectedFolderId === id;
    const isActive = folder === f.title;
    const count = hasBookmarks ? node.bookmarks.length : 0;

    let html = `<div class="tree-item">
      <div class="tree-row ${isActive ? 'active' : ''}" data-folder-id="${id}" data-folder-name="${esc(f.title)}">
        <button class="tree-toggle ${hasChildren ? (isOpen ? 'open' : '') : 'leaf'}" data-toggle="${id}" aria-label="Développer">
          ${icon('chevron-right')}
        </button>
        ${icon('folder')}
        <span>${esc(f.title)}</span>
        ${count ? `<span class="tree-count">${count}</span>` : ''}
      </div>`;

    if (isOpen && hasChildren) {
      html += `<div class="tree-children">`;
      node.children.forEach(cid => { html += renderNode(cid, depth + 1); });
      html += `</div>`;
    }

    html += `</div>`;

    if (isOpen && hasBookmarks) {
      bookmarksInFolder = node.bookmarks;
    }

    return html;
  }

  let html = '';
  rootChildren.forEach(id => { html += renderNode(id, 0); });
  if (!html) html = `<div class="empty-tree"><small>Aucun dossier</small></div>`;
  tree.innerHTML = html;

  const list = $('bookmarksInFolder');
  const section = $('bookmarksInFolderSection');
  if (selectedFolderId && bookmarksInFolder.length) {
    section.hidden = false;
    $('currentFolderName').textContent = folderMap.get(selectedFolderId)?.folder.title || '';
    list.innerHTML = bookmarksInFolder.map(b => `
      <li data-id="${b.id}" class="bookmark-item">
        ${icon('bookmark')}
        <span class="bk-url">${esc(titleOf(b))}</span>
        <a class="open-link" href="${esc(b.url)}" target="_blank" rel="noopener" title="Ouvrir">${icon('arrow-up-right')}</a>
      </li>
    `).join('');
  } else {
    section.hidden = true;
  }
}

function animateCount(el, target, duration = 800) {
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function render() {
  const target = all.length;
  animateCount($('count'), target, 800);
  let filtered = all.filter(b => folder === 'all' || b.folder === folder);
  if (category !== 'all') {
    filtered = filtered.filter(b => b.folder === category);
  }
  if (selectedTag) {
    const tags = await ensureTags();
    filtered = filtered.filter(b => (tags[b.id] || []).includes(selectedTag));
  }
  filtered = search(filtered, q.value);
  const [key, dir] = sort.split('-');
  filtered.sort((a, b) => {
    let va, vb;
    if (key === 'date') { va = a.added || 0; vb = b.added || 0; }
    else if (key === 'name') { va = (a.title || domainOf(a.url)).toLowerCase(); vb = (b.title || domainOf(b.url)).toLowerCase(); }
    else if (key === 'folder') { va = a.folder.toLowerCase(); vb = b.folder.toLowerCase(); }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  view = filtered;
  io.disconnect();
  if (!view.length) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">${icon(all.length ? 'search-x' : 'inbox')}</div>
      <h3>${all.length ? 'Aucun favori trouvé' : 'Votre bibliothèque est vide'}</h3>
      <p>${all.length ? 'Essayez une autre recherche ou un autre dossier.' : 'Ajoutez un favori dans Chrome (Ctrl+D) : il apparaîtra ici automatiquement.'}</p></div>`;
  } else {
    grid.innerHTML = view.map(card).join('');
    grid.querySelectorAll('.thumb').forEach(t => io.observe(t));
  }
  paintSel();
}

async function renderTags() {
  const list = $('tagList');
  const tags = await getTagList();
  list.innerHTML = [['all', 'Tous'], ...tags.map(t => [t, t])]
    .map(([v, l]) => {
      const isActive = selectedTag === v;
      const removeHtml = v === 'all' ? '' : `<button class="remove-tag" data-remove-tag="${esc(v)}" title="Supprimer le tag" aria-label="Supprimer ${esc(v)}">×</button>`;
      return `<button class="tag-chip ${isActive ? 'active' : ''}" data-tag="${esc(v)}">${esc(l)}${removeHtml}</button>`;
    }).join('');
}

/* ---------- Aperçus : chargés à l'apparition de la carte ---------- */
const io = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  io.unobserve(en.target);
  loadThumb(en.target);
}), { rootMargin: '300px' });

async function loadThumb(el) {
  const m = canPreview ? await getMeta(el.dataset.url) : await peek(el.dataset.url);
  if (!m?.img || !el.isConnected) return;
  const im = new Image();
  im.className = 'shot'; im.alt = ''; im.referrerPolicy = 'no-referrer';
  im.onload = () => { if (el.isConnected) { el.prepend(im); el.classList.add('has-shot'); } };
  im.src = m.img;
}

// Image introuvable → icône de repli
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG') return;
  if (t.classList.contains('fav-big')) t.outerHTML = `<span class="fav-big">${icon('globe')}</span>`;
  else if (t.classList.contains('fav')) t.outerHTML = icon('globe');
  else if (t.classList.contains('shot')) t.outerHTML = `<span class="fav-big">${icon('image')}</span>`;
}, true);

/* ---------- Sélection multiple ---------- */
function paintSel() {
  document.body.classList.toggle('selecting', sel.size > 0);
  grid.querySelectorAll('.bookmark').forEach(el => {
    const on = sel.has(el.dataset.id);
    el.classList.toggle('sel', on);
    el.querySelector('.pick').setAttribute('aria-pressed', on);
  });
  $('bulk').classList.toggle('on', sel.size > 0);
  $('bulkCount').textContent = `${sel.size} sélectionné${sel.size > 1 ? 's' : ''}`;
}

function pick(id, range) {
  if (range && lastPick) {
    const ids = view.map(b => b.id), a = ids.indexOf(lastPick), z = ids.indexOf(id);
    if (a >= 0 && z >= 0) ids.slice(Math.min(a, z), Math.max(a, z) + 1).forEach(i => sel.add(i));
  } else sel.has(id) ? sel.delete(id) : sel.add(id);
  lastPick = id;
  paintSel();
}

grid.addEventListener('click', e => {
  const c = e.target.closest('.bookmark');
  if (!c || e.target.closest('.open-link')) return;
  const id = c.dataset.id;
  if (e.target.closest('.pick') || e.ctrlKey || e.metaKey || e.shiftKey || sel.size) pick(id, e.shiftKey);
  else openDrawer(id);
});

  $('folderTree').addEventListener('click', async e => {
  const toggle = e.target.closest('.tree-toggle');
  if (toggle) {
    e.stopPropagation();
    const id = toggle.dataset.toggle;
    const isOpen = toggle.classList.toggle('open');
    const node = toggle.closest('.tree-item');
    const children = node.querySelector(':scope > .tree-children');
    if (children) children.style.display = isOpen ? '' : 'none';
    return;
  }
  const row = e.target.closest('.tree-row');
  if (!row) return;
  const id = row.dataset.folderId;
  const name = row.dataset.folderName;
  if (selectedFolderId === id) {
    selectedFolderId = null;
    folder = 'all';
  } else {
    selectedFolderId = id;
    folder = name;
  }
  document.querySelectorAll('.tree-row').forEach(r => r.classList.toggle('active', r === row));
  buildTree($('treeSearch').value);
  render();
});

$('treeSearch').addEventListener('input', e => {
  buildTree(e.target.value);
});

$('bookmarksInFolder').addEventListener('click', e => {
  const item = e.target.closest('.bookmark-item');
  const link = e.target.closest('.open-link');
  if (link) return;
  if (!item) return;
  const id = item.dataset.id;
  if (e.ctrlKey || e.metaKey || e.shiftKey || sel.size) pick(id, e.shiftKey);
  else openDrawer(id);
});

$('sidebarToggle').addEventListener('click', () => {
  const sidebar = $('sidebar');
  sidebar.classList.toggle('collapsed');
  const isClosed = sidebar.classList.contains('collapsed');
  $('sidebarToggle').dataset.icon = isClosed ? 'panel-right-open' : 'panel-right-close';
  $('sidebarToggle').innerHTML = icon($('sidebarToggle').dataset.icon);
});

q.addEventListener('input', render);

$('sortSelect').addEventListener('change', e => {
  sort = e.target.value;
  render();
});

/* ---------- Actions : supprimer / déplacer ---------- */
async function del(ids) {
  const items = ids.map(byId).filter(Boolean);
  if (!items.length) return;
  if (items.length > 1 && !confirm(`Supprimer ${items.length} favoris de Chrome ?`)) return;
  try { await removeMany(items.map(b => b.id)); } catch { return toast('Échec de la suppression'); }
  items.forEach(b => sel.delete(b.id));
  if (current && ids.includes(current)) closeDrawer(false);
  paintSel();
  toast(items.length > 1 ? `${items.length} favoris supprimés` : 'Favori supprimé', { label: 'Annuler', fn: () => restore(items) });
}

$('bulkMove').addEventListener('change', async e => {
  let id = e.target.value; e.target.value = '';
  if (!id) return;
  if (id === '__new') {
    const name = prompt('Nom du nouveau dossier :');
    if (!name?.trim()) return;
    try { id = (await createFolder(name.trim())).id; } catch { return toast('Impossible de créer le dossier'); }
  }
  const ids = [...sel];
  try { await moveMany(ids, id); sel.clear(); paintSel(); toast(`${ids.length} favori${ids.length > 1 ? 's' : ''} déplacé${ids.length > 1 ? 's' : ''}`); }
  catch { toast('Échec du déplacement'); }
});
$('bulkAll').onclick = () => { view.forEach(b => sel.add(b.id)); paintSel(); };
$('bulkClear').onclick = () => { sel.clear(); paintSel(); };
$('bulkDel').onclick = () => del([...sel]);
$('bulkOpen').onclick = () => {
  const items = [...sel].map(byId).filter(Boolean);
  if (items.length > 8 && !confirm(`Ouvrir ${items.length} onglets ?`)) return;
  items.forEach(visit);
};

/* ---------- Panneau de détails ---------- */
function paintDrawer(b, m) {
  const when = b.added ? new Date(b.added).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  $('drBody').innerHTML = `
    <div class="dr-shot">${m?.img
      ? `<img class="shot" src="${esc(m.img)}" referrerpolicy="no-referrer" alt="">`
      : `<img class="fav-big" src="${faviconUrl(b.url, 64)}" alt="">`}</div>
    ${canPreview ? '' : `<div class="dr-note"><span>Aperçu du site désactivé.</span><button class="btn-l" id="drEnable">${icon('image')} Activer</button></div>`}
    <h2>${esc(titleOf(b))}</h2>
    <a class="dr-link" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.url)}</a>
    ${m?.desc ? `<p class="dr-desc">${esc(m.desc)}</p>` : ''}
    <div class="dr-meta">
      <div>${icon('folder')}<span>${esc(b.path || b.folder)}</span></div>
      <div>${icon('calendar')}<span>Ajouté le ${when}</span></div>
      ${m?.site ? `<div>${icon('globe')}<span>${esc(m.site)}</span></div>` : ''}
    </div>`;
  $('drVisit').href = b.url;
  const i = view.findIndex(x => x.id === b.id);
  $('drPrev').disabled = i <= 0;
  $('drNext').disabled = i < 0 || i >= view.length - 1;
}

async function openDrawer(id) {
  const b = byId(id); if (!b) return;
  if (!current) returnFocus = document.activeElement;
  current = id;
  const cached = await peek(b.url);
  if (current !== id) return;
  paintDrawer(b, cached);
  $('drawer').classList.add('on'); $('scrim').classList.add('on');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('drVisit').focus();
  if (canPreview) {
    const m = await getMeta(b.url);
    if (current === id && m !== cached) paintDrawer(b, m);
  }
}

function closeDrawer(restoreFocus = true) {
  current = null;
  $('drawer').classList.remove('on'); $('scrim').classList.remove('on');
  $('drawer').setAttribute('aria-hidden', 'true');
  if (restoreFocus) returnFocus?.focus?.();
}

const step = d => { const i = view.findIndex(b => b.id === current), n = view[i + d]; if (n) openDrawer(n.id); };
$('drClose').onclick = $('scrim').onclick = () => closeDrawer();
$('drPrev').onclick = () => step(-1);
$('drNext').onclick = () => step(1);
$('drDelete').onclick = () => del([current]);
$('drEdit').onclick = () => openEdit(current);
$('drCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(byId(current).url); toast('Lien copié'); } catch { toast('Copie impossible'); }
};
$('drRefresh').onclick = async () => {
  if (!canPreview) return toast('Activez d’abord les aperçus');
  const b = byId(current); if (!b) return;
  const m = await getMeta(b.url, { force: true });
  if (current === b.id) paintDrawer(b, m);
  render();
};
$('drBody').addEventListener('click', e => { if (e.target.closest('#drEnable')) enablePreviews(); });

function renderDrawerTags(bookmarkId) {
  getTags().then(tags => {
    const list = $('drTagList');
    const currentTags = tags[bookmarkId] || [];
    const allTags = [...new Set([...Object.values(tags).flat(), ...currentTags])].sort((a, b) => a.localeCompare(b, 'fr'));
    list.innerHTML = allTags.map(t => {
      const active = currentTags.includes(t);
      return `<button class="tag-chip ${active ? 'active' : ''}" data-drawer-tag="${esc(t)}">${esc(t)}<span class="remove-tag" data-drawer-remove="${esc(t)}">×</span></button>`;
    }).join('');
  });
}

$('drTags').onclick = async () => {
  if (!current) return;
  const panel = $('drTagsPanel');
  panel.hidden = false;
  renderDrawerTags(current);
};

$('drTagsClose').onclick = () => { $('drTagsPanel').hidden = true; };

$('drTagList').addEventListener('click', async e => {
  const remove = e.target.closest('[data-drawer-remove]');
  if (remove) {
    const tag = remove.dataset.drawerRemove;
    const b = byId(current); if (!b) return;
    const tags = await getTags();
    const list = tags[b.id] || [];
    await setTags(b.id, list.filter(t => t !== tag));
    renderDrawerTags(b.id);
    render();
    return;
  }
  const chip = e.target.closest('[data-drawer-tag]'); if (!chip) return;
  const b = byId(current); if (!b) return;
  const tag = chip.dataset.drawerTag;
  const tags = await getTags();
  const list = new Set(tags[b.id] || []);
  if (list.has(tag)) list.delete(tag); else list.add(tag);
  await setTags(b.id, [...list]);
  renderDrawerTags(b.id);
  render();
});

$('drTagAddBtn').addEventListener('click', async () => {
  const input = $('drTagCreate');
  const value = input.value.trim(); if (!value || !current) return;
  input.value = '';
  const tags = await getTags();
  const list = new Set(tags[current] || []);
  list.add(value);
  await setTags(current, [...list]);
  renderDrawerTags(current);
  render();
});

$('drTagCreate').addEventListener('keydown', e => { if (e.key === 'Enter') $('drTagAddBtn').click(); });

/* ---------- Modification d'un favori ---------- */
function openEdit(id) {
  const b = byId(id); if (!b) return;
  editing = id;
  $('edTitle').value = b.title; $('edUrl').value = b.url;
  $('edFolder').innerHTML = '<option value="">—</option>' +
    folders.map(f => `<option value="${f.id}" ${f.id === b.parentId ? 'selected' : ''}>${esc(f.path)}</option>`).join('') +
    '<option value="__new">＋ Créer un nouveau dossier…</option>';
  $('edNewFolder').value = '';
  $('editModal').hidden = false;
  $('edTitle').focus();
}
const closeEdit = () => { $('editModal').hidden = true; editing = null; };
$('edCancel').onclick = closeEdit;
$('editModal').addEventListener('mousedown', e => { if (e.target === $('editModal')) closeEdit(); });
$('edFolder').addEventListener('change', e => {
  const isNew = e.target.value === '__new';
  $('edNewFolder').hidden = !isNew;
  if (!isNew) $('edNewFolder').value = '';
});
$('editForm').addEventListener('submit', async e => {
  e.preventDefault();
  const b = byId(editing); if (!b) return closeEdit();
  const title = $('edTitle').value.trim(), url = $('edUrl').value.trim(), parent = $('edFolder').value;
  if (!/^https?:\/\//i.test(url)) return toast('L’adresse doit commencer par http:// ou https://');
  try {
    if (title !== b.title || url !== b.url) await updateOne(b.id, { title, url });
    let folderId = parent;
    if (parent === '__new') {
      const name = $('edNewFolder').value.trim();
      if (!name) return toast('Nom de dossier requis');
      try { folderId = (await createFolder(name)).id; }
      catch { return toast('Impossible de créer le dossier'); }
    }
    if (folderId && folderId !== b.parentId) await moveMany([b.id], folderId);
    toast('Favori mis à jour');
  } catch (err) { toast('Échec : ' + err.message); }
  closeEdit();
});

/* ---------- Aperçus : autorisation ---------- */
function enablePreviews() {
  requestAccess().then(ok => {
    canPreview = ok; $('enableBox').hidden = ok;
    if (ok) { render(); const b = byId(current); if (b) openDrawer(current); }
  });
}
$('enablePreviews').onclick = enablePreviews;

/* ---------- Clavier ---------- */
const cards = () => [...grid.querySelectorAll('.bookmark')];
const cols = () => getComputedStyle(grid).gridTemplateColumns.split(' ').length;

document.addEventListener('keydown', e => {
  const k = e.key, mod = e.ctrlKey || e.metaKey, ae = document.activeElement;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
  if (!$('editModal').hidden) { if (k === 'Escape') closeEdit(); return; }
  if (current) {
    if (k === 'Escape') { e.preventDefault(); closeDrawer(); }
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !typing) { e.preventDefault(); step(k === 'ArrowLeft' ? -1 : 1); }
    return;
  }
  if ((k === '/' && !typing) || (mod && k.toLowerCase() === 'k')) { e.preventDefault(); q.focus(); q.select(); return; }
  if (k === 'Escape') { if (sel.size) { sel.clear(); paintSel(); return; } if (q.value) { q.value = ''; render(); } q.focus(); return; }
  if (mod && k.toLowerCase() === 'a' && !typing) { e.preventDefault(); view.forEach(b => sel.add(b.id)); paintSel(); return; }

  const c = ae.closest?.('.bookmark'), id = c?.dataset.id;
  if (k === 'Delete' && !typing) {
    const ids = sel.size ? [...sel] : id ? [id] : [];
    if (ids.length) { e.preventDefault(); del(ids); }
    return;
  }
  const list = cards(); if (!list.length) return;
  const i = list.indexOf(c);
  const go = n => { e.preventDefault(); list[Math.max(0, Math.min(list.length - 1, n))].focus(); };
  if (ae === q) {
    if (k === 'ArrowDown') go(0);
    else if (k === 'Enter' && view[0]) { e.preventDefault(); mod ? visit(view[0]) : openDrawer(view[0].id); }
  } else if (i >= 0) {
    if (k === 'ArrowRight') go(i + 1);
    else if (k === 'ArrowLeft') go(i - 1);
    else if (k === 'ArrowDown') go(i + cols());
    else if (k === 'ArrowUp') i < cols() ? (e.preventDefault(), q.focus()) : go(i - cols());
    else if (ae === c && k === 'Enter') { e.preventDefault(); mod ? visit(byId(id)) : sel.size ? pick(id) : openDrawer(id); }
    else if (ae === c && k === ' ') { e.preventDefault(); pick(id); }
  }
});

$('manage').onclick = () => chrome.tabs.create({ url: 'chrome://bookmarks' });
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

function renderCategories() {
  const list = $('categoryList');
  const categories = [...new Set(all.map(b => b.folder))].sort((a, b) => a.localeCompare(b, 'fr'));
  list.innerHTML = [['all', 'Tous'], ...categories.map(c => [c, c])]
    .map(([v, l]) => `<button class="category-chip ${v === category ? 'active' : ''}" data-category="${esc(v)}">${esc(l)}</button>`).join('');
}

$('categoryList').addEventListener('click', e => {
  const c = e.target.closest('.category-chip'); if (!c) return;
  category = c.dataset.category;
  renderCategories();
  render();
});

$('tagList').addEventListener('click', async e => {
  const removeBtn = e.target.closest('.remove-tag');
  if (removeBtn) {
    e.stopPropagation();
    const tag = removeBtn.dataset.removeTag;
    await removeTag(tag);
    if (selectedTag === tag) selectedTag = null;
    await invalidateTags();
    await renderTags();
    render();
    return;
  }
  const chip = e.target.closest('.tag-chip'); if (!chip) return;
  selectedTag = selectedTag === chip.dataset.tag ? null : chip.dataset.tag;
  await renderTags();
  render();
});

$('tagAddBtn').addEventListener('click', async () => {
  const input = $('tagCreate');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  await addTag(value);
  selectedTag = value;
  await invalidateTags();
  await renderTags();
  render();
});

$('tagCreate').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('tagAddBtn').click();
});

/* ---------- Chargement + synchro en direct ---------- */
async function load() {
  [all, folders] = await Promise.all([getBookmarks(), getFolders()]);
  for (const id of [...sel]) if (!byId(id)) sel.delete(id);
  buildTree();
  renderCategories();
  await renderTags();
  $('bulkMove').innerHTML = '<option value="">Déplacer vers…</option>' +
    folders.map(f => `<option value="${f.id}">${esc(f.path)}</option>`).join('') + '<option value="__new">＋ Nouveau dossier…</option>';
  render();
  if (current) { const b = byId(current); b ? paintDrawer(b, await peek(b.url)) : closeDrawer(false); }
}

canPreview = await hasAccess();
$('enableBox').hidden = canPreview;
watch(load);
await load();
