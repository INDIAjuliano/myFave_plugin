import { getBookmarks, search } from './shared/data.js';

const esc = s => s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
const openLibrary = () => chrome.tabs.create({ url: chrome.runtime.getURL('myfav.html') });

// Raccourci : bibliothèque complète
chrome.commands.onCommand.addListener(cmd => { if (cmd === 'open-library') openLibrary(); });

// Barre d'adresse : tapez « fav » puis Tab, puis votre recherche
chrome.omnibox.setDefaultSuggestion({ description: 'Rechercher dans mes favoris : %s' });
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const hits = search(await getBookmarks(), text).slice(0, 6);
  suggest(hits.map(b => ({ content: b.url, description: `${esc(b.title || b.url)} <url>${esc(b.url)}</url>` })));
});
chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  let url = /^https?:\/\//i.test(text) ? text : (search(await getBookmarks(), text)[0] || {}).url;
  if (!url) return openLibrary();
  if (disposition === 'currentTab') chrome.tabs.update({ url });
  else chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
});
