import { ICONS } from './icons-data.js';

export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const esc = (s = '') => s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));

// Sprite SVG inline (les pages d'extension n'autorisent pas de ressources externes)
const sprite = document.createElement('div');
sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
sprite.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' +
  Object.entries(ICONS).map(([n, body]) => `<symbol id="i-${n}" viewBox="0 0 24 24">${body}</symbol>`).join('') + '</svg>';
document.body.prepend(sprite);

// <i data-icon="search"></i> → icône mynaui
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
