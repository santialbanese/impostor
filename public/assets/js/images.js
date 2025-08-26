// public/assets/js/images.js
const cache = new Map();

const REST_SEARCH = (lang, q) =>
  `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=1`;
const REST_SUMMARY = (lang, titleKey) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleKey)}`;

const HINTS = {
  peliculas: [' (película)', ' (film)'],
  fútbol: [' (futbolista)', ' (footballer)'],
  futbol: [' (futbolista)', ' (footballer)'],      // por si llega sin tilde
  cantantes: [' (cantante)', ' (singer)'],
};

const ALIASES = {
  // Si algún nombre puntual te falla, lo fijas acá:
  // 'minions': { es: 'Minions (película de 2015)', en: 'Minions (film)' },
};

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function wikipediaSearchWithHints(name, lang, hints = []) {
  // 1) alias fijo primero
  const lowered = name.toLowerCase();
  const alias = ALIASES[lowered];
  if (alias && alias[lang]) {
    const sum = await fetchJSON(REST_SUMMARY(lang, alias[lang]));
    const img = sum?.originalimage?.source || sum?.thumbnail?.source || sum?.thumbnail?.url || null;
    if (img) return img;
  }

  // 2) probar: nombre “plano”, luego con hints (“(película)”, “(futbolista)”, etc.)
  const variants = [name, ...hints.map(h => name + h)];
  for (const q of variants) {
    const s = await fetchJSON(REST_SEARCH(lang, q));
    const first = s?.pages?.[0];
    if (!first) continue;

    // Probar summary para imagen “originalimage”
    const sum = await fetchJSON(REST_SUMMARY(lang, first.key));
    const img = sum?.originalimage?.source || sum?.thumbnail?.source || first?.thumbnail?.url || null;
    if (img) return img;
  }
  return null;
}

async function getFromDeezerArtist(name) {
  try {
    const data = await fetchJSON(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}`);
    const hit = data?.data?.[0];
    return hit?.picture_xl || hit?.picture_big || hit?.picture_medium || hit?.picture || null;
  } catch {
    return null;
  }
}

function normalizeCategory(cat = '') {
  const c = (cat || '').toLowerCase();
  if (c.includes('pelí') || c.includes('peli') || c.includes('movie')) return 'peliculas';
  if (c.includes('fútbol') || c.includes('futbol')) return 'fútbol';
  if (c.includes('cantant') || c.includes('música') || c.includes('musica')) return 'cantantes';
  return c;
}

function placeholderDataURI(label = 'Sin imagen') {
  // SVG simple como placeholder
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#374151"/>
      <stop offset="100%" stop-color="#1f2937"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="36" text-anchor="middle" dominant-baseline="middle">
    ${label}
  </text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * getImageForItem(name, category)
 * - cantantes: Deezer -> Wikipedia(ES/EN con hints)
 * - películas: Wikipedia(ES/EN con “(película)/(film)”)
 * - fútbol: Wikipedia(ES/EN con “(futbolista)/(footballer)”)
 * - otros: Wikipedia ES -> EN
 */
export async function getImageForItem(name, category = '') {
  const key = `${category}:${name}`;
  if (cache.has(key)) return cache.get(key);

  const normCat = normalizeCategory(category);
  const hints = HINTS[normCat] || [];

  let url = null;

  try {
    if (normCat === 'cantantes') {
      // 1) Deezer, 2) Wikipedia ES, 3) Wikipedia EN
      url =
        (await getFromDeezerArtist(name)) ||
        (await wikipediaSearchWithHints(name, 'es', hints)) ||
        (await wikipediaSearchWithHints(name, 'en', hints));
    } else if (normCat === 'peliculas' || normCat === 'fútbol' || normCat === 'futbol') {
      url =
        (await wikipediaSearchWithHints(name, 'es', hints)) ||
        (await wikipediaSearchWithHints(name, 'en', hints));
    } else {
      // otros: Wikipedia ES -> EN sin hints
      url =
        (await wikipediaSearchWithHints(name, 'es', [])) ||
        (await wikipediaSearchWithHints(name, 'en', []));
    }
  } catch (e) {
    console.warn('getImageForItem error', e);
  }

  if (!url) url = placeholderDataURI(name);

  cache.set(key, url);
  return url;
}
