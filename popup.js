import { getBookmarks, search, domainOf, faviconUrl } from './shared/data.js';
import { icon, esc } from './shared/ui.js';

const q = document.getElementById('q'), list = document.getElementById('list');
let all = [];

function render() {
  const hits = search(all, q.value).slice(0, 40);
  list.innerHTML = hits.length ? hits.map(b => `
    <a class="row" href="${esc(b.url)}" target="_blank" rel="noopener">
      <span class="fav"><img src="${faviconUrl(b.url)}" alt=""></span>
      <span class="txt"><div class="t">${esc(b.title || domainOf(b.url))}</div><div class="u">${esc(domainOf(b.url))}</div></span>
      <span class="f">${esc(b.folder)}</span>
    </a>`).join('')
    : `<div class="empty">${icon(all.length ? 'search-x' : 'inbox')}<span>${all.length ? 'Aucun favori trouvé' : 'Aucun favori pour le moment'}</span></div>`;
}

list.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') e.target.parentNode.innerHTML = icon('globe');
}, true);

q.addEventListener('input', render);
document.addEventListener('keydown', e => {
  const rows = [...list.querySelectorAll('.row')], i = rows.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || rows[0])?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? q.focus() : rows[i - 1].focus(); }
  else if (e.key === 'Enter' && document.activeElement === q && rows[0]) {
    e.preventDefault();
    chrome.tabs.create({ url: rows[0].href, active: !(e.ctrlKey || e.metaKey) });
    if (!(e.ctrlKey || e.metaKey)) window.close();
  }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement !== q) q.focus();
});

document.getElementById('library').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('myfav.html') }); window.close(); };

getBookmarks().then(b => { all = b; render(); });
