// src/ui.js
import { state } from './state.js';

export function updateResolutionBadge() {
  const badge = document.getElementById('res-badge');
  if (!badge) return;

  const multiplierMap = { '2x': 2000, '3x': 3000, '4x': 4000, '5x': 5000 };
  const dim = multiplierMap[state.exportScale] || 3000;
  const fmt = state.exportFormat.toUpperCase();

  badge.innerText = `${dim} x ${dim} px • 300 DPI (${fmt})`;
}

export function updateApiBadgeUI() {
  const badgeText = document.getElementById('api-badge-text');
  if (!badgeText) return;

  const validGemini = state.apiKeys.filter(k => k && k.trim().length > 0).length;
  const activeImageKey = state.imageApiKeys ? state.imageApiKeys[state.imageProvider || 'fal'] : '';
  const hasImageKey = Boolean(activeImageKey && activeImageKey.trim().length > 0);

  if (validGemini > 0 && hasImageKey) {
    badgeText.innerText = `AI Aktif (Gemini + ${(state.imageProvider || 'fal').toUpperCase()})`;
    badgeText.style.color = '#34d399';
  } else if (validGemini > 0) {
    badgeText.innerText = `Gemini SEO Aktif (${validGemini} Key)`;
    badgeText.style.color = '#a5b4fc';
  } else if (hasImageKey) {
    badgeText.innerText = `Çizim Aktif (${(state.imageProvider || 'fal').toUpperCase()})`;
    badgeText.style.color = '#c084fc';
  } else {
    badgeText.innerText = `AI & API Havuzu`;
    badgeText.style.color = '';
  }
}
