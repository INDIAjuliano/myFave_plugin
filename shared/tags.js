// Stockage local des tags par bookmark id
const TAGS_KEY = 'bookmarkTags';
const ALL_TAGS_KEY = 'allTags';

function tagsKey() { return TAGS_KEY; }

function allTagsKey() { return ALL_TAGS_KEY; }

function emptyTags() { return {}; }

async function loadTags() {
  try {
    const data = await chrome.storage.local.get(tagsKey());
    return data[tagsKey()] || emptyTags();
  } catch { return emptyTags(); }
}

async function saveTags(tags) {
  try { await chrome.storage.local.set({ [tagsKey()]: tags }); } catch {}
}

export async function getTags() {
  return loadTags();
}

export async function setTags(bookmarkId, tagList) {
  const tags = await loadTags();
  if (!tagList || tagList.length === 0) delete tags[bookmarkId];
  else tags[bookmarkId] = Array.from(new Set(tagList));
  await saveTags(tags);
  const all = await loadAllTags();
  const set = new Set(all);
  (tagList || []).forEach(t => set.add(t));
  await saveAllTags([...set].sort((a, b) => a.localeCompare(b, 'fr')));
  return tags;
}

async function loadAllTags() {
  try {
    const data = await chrome.storage.local.get(allTagsKey());
    return data[allTagsKey()] || [];
  } catch { return []; }
}

async function saveAllTags(tags) {
  try { await chrome.storage.local.set({ [allTagsKey()]: tags }); } catch {}
}

export async function getTagList() {
  return loadAllTags();
}

export async function addTag(name) {
  const all = await loadAllTags();
  const set = new Set(all);
  set.add(name);
  const list = [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  await saveAllTags(list);
  return list;
}

export async function removeTag(name) {
  let all = await loadAllTags();
  all = all.filter(t => t !== name);
  await saveAllTags(all);
  const tags = await loadTags();
  for (const id of Object.keys(tags)) {
    tags[id] = tags[id].filter(t => t !== name);
    if (!tags[id].length) delete tags[id];
  }
  await saveTags(tags);
}
