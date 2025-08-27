// public/assets/js/images.js
const cache = new Map();

const REST_SEARCH = (lang, q) =>
  `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=1`;
const REST_SUMMARY = (lang, titleKey) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleKey)}`;

const HINTS = {
  peliculas: [' (película)', ' (film)'],
  fútbol: [' (futbolista)', ' (footballer)'],
  futbol: [' (futbolista)', ' (footballer)'],
  cantantes: [' (cantante)', ' (singer)'],
};

// Aliases por si algún nombre te da resultados raros
const ALIASES = {
  'minions': { es: 'Minions (película de 2015)', en: 'Minions (film)' },
  'the office': { es: 'The Office (serie de televisión estadounidense)', en: 'The Office (American TV series)' },
  'friends': { es: 'Friends (serie de televisión)', en: 'Friends' },
  'gimnasia de la plata': { es: 'Club de Gimnasia y Esgrima La Plata', en: 'Gimnasia y Esgrima La Plata' },
  'gimnasia y esgrima la plata': { es: 'Club de Gimnasia y Esgrima La Plata', en: 'Gimnasia y Esgrima La Plata' },
};

// ---------- Utilidades ----------
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    return await r.json();
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
function looksLikeTeamName(name = '') {
  return /club|fc|cf|fútbol|football|sporting|deportivo|united|city|athletic|calcio|bayern|borussia|olympique|ajax|benfica|porto|sporting/i.test(name);
}
function placeholderDataURI(label = 'Sin imagen') {
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

// ---------- Wikipedia helpers ----------
function pickImageFromSummary(sum, { preferLogo = false } = {}) {
  if (!sum) return null;
  const cand =
    sum.originalimage?.source ||
    sum.thumbnail?.source ||
    sum.thumbnail?.url ||
    null;

  if (!preferLogo || !cand) return cand;

  const u = cand.toLowerCase();
  if (/(logo|escudo|crest|badge)/.test(u)) return cand;
  return cand;
}

async function wikipediaTryQueries(lang, queries, { preferLogo = false } = {}) {
  for (const q of queries) {
    const s = await fetchJSON(REST_SEARCH(lang, q));
    const first = s?.pages?.[0];
    if (!first) continue;

    const sum = await fetchJSON(REST_SUMMARY(lang, first.key));
    const img = pickImageFromSummary(sum, { preferLogo });
    if (img) return img;
  }
  return null;
}

// ---------- Wikidata (logos) ----------
async function wikidataSearchEntity(name, lang = 'es') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
    name
  )}&language=${lang}&format=json&origin=*`;
  const res = await fetchJSON(url);
  return res?.search?.[0]?.id || null;
}
async function wikidataGetLogoFile(entityId) {
  // P154 = logo image
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(
    entityId
  )}&property=P154&format=json&origin=*`;
  const res = await fetchJSON(url);
  const claim = res?.claims?.P154?.[0]?.mainsnak?.datavalue?.value || null;
  // claim es un filename de Commons, ej: "Real Madrid CF.svg"
  return typeof claim === 'string' ? claim : null;
}
function commonsFileURL(fileName, width = 512) {
  // Devuelve un PNG/redirect escalado si es SVG
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${width}`;
}

// ---------- Deezer (artistas) ----------
async function getFromDeezerArtist(name) {
  try {
    const data = await fetchJSON(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}`);
    const hit = data?.data?.[0];
    return hit?.picture_xl || hit?.picture_big || hit?.picture_medium || hit?.picture || null;
  } catch {
    return null;
  }
}

// ---------- API principal ----------
/**
 * getImageForItem(name, category, opts)
 * - opts.subtopic: útil para detectar subtema “Equipos” en Fútbol
 * - Para equipos: Wikidata P154 (logo) → Wikipedia (consultas con 'escudo/logo/crest')
 * - Cantantes: Deezer → Wikipedia
 * - Películas: Wikipedia con hints (película/film)
 * - Futbolistas: Wikipedia con hints (futbolista/footballer)
 * - Otros: Wikipedia ES → EN
 */
export async function getImageForItem(name, category = '', opts = {}) {
  const title = String(name || '').trim();
  const normCat = normalizeCategory(category);
  const subtopic = String(opts.subtopic || '');
  const lowered = title.toLowerCase();
  const alias = ALIASES[lowered];
  const isTeam =
    (normCat === 'fútbol' && /equip/i.test(subtopic)) ||
    opts.isTeam === true ||
    looksLikeTeamName(title);

  const cacheKey = `${normCat}:${subtopic}:${title}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let url = null;

  try {
    // 0) Alias directo (Wikipedia summary)
    if (alias) {
      const sumES = await fetchJSON(REST_SUMMARY('es', alias.es || alias.en || title));
      url = pickImageFromSummary(sumES, { preferLogo: isTeam });
      if (!url && alias.en) {
        const sumEN = await fetchJSON(REST_SUMMARY('en', alias.en));
        url = pickImageFromSummary(sumEN, { preferLogo: isTeam });
      }
      if (url) {
        cache.set(cacheKey, url);
        return url;
      }
    }

    if (isTeam) {
      // 1) EQUIPOS → Wikidata P154 (logo image)
      const qId =
        (await wikidataSearchEntity(title, 'es')) ||
        (await wikidataSearchEntity(title, 'en'));
      if (qId) {
        const logoFile = await wikidataGetLogoFile(qId);
        if (logoFile) {
          url = commonsFileURL(logoFile, 512);
        }
      }

      // 2) Fallback: Wikipedia con queries que “fuerzan” logos
      if (!url) {
        const queriesES = [
          `${title} escudo`,
          `${title} logo`,
          `${title} (club)`,
          `${title} club de fútbol`,
          title,
        ];
        const queriesEN = [
          `${title} logo`,
          `${title} crest`,
          `${title} (football club)`,
          title,
        ];
        url =
          (await wikipediaTryQueries('es', queriesES, { preferLogo: true })) ||
          (await wikipediaTryQueries('en', queriesEN, { preferLogo: true }));
      }
    } else if (normCat === 'cantantes') {
      url =
        (await getFromDeezerArtist(title)) ||
        (await wikipediaTryQueries('es', [title, ...HINTS.cantantes.map(h => title + h)])) ||
        (await wikipediaTryQueries('en', [title, ...HINTS.cantantes.map(h => title + h)]));
    } else if (normCat === 'peliculas') {
      url =
        (await wikipediaTryQueries('es', [title, ...HINTS.peliculas.map(h => title + h)])) ||
        (await wikipediaTryQueries('en', [title, ' (film)']));
    } else if (normCat === 'fútbol') {
      // Futbolistas
      url =
        (await wikipediaTryQueries('es', [title, ...HINTS.fútbol.map(h => title + h)])) ||
        (await wikipediaTryQueries('en', [title, ...HINTS.futbol.map(h => title + h)]));
    } else {
      // Otros
      url =
        (await wikipediaTryQueries('es', [title])) ||
        (await wikipediaTryQueries('en', [title]));
    }
  } catch (e) {
    console.warn('getImageForItem error', e);
  }

  if (!url) url = placeholderDataURI(title);

  cache.set(cacheKey, url);
  return url;
}
