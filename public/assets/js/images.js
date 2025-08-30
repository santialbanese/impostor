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

// ---------- Nueva función para extraer y limpiar descripción ----------
function extractDescription(summary, maxLength = 150) {
  if (!summary?.extract) return null;
  
  let desc = summary.extract;
  
  // Limpiar texto común que no aporta
  desc = desc.replace(/^(.*?\s+)?(es|fue|era|son)\s+/i, '');
  desc = desc.replace(/^(.*?\s+)?(is|was|were|are)\s+/i, '');
  
  // Remover referencias entre paréntesis al final
  desc = desc.replace(/\s*\([^)]*\)\s*$/, '');
  
  // Cortar en punto si es muy largo
  if (desc.length > maxLength) {
    const cutAt = desc.lastIndexOf('.', maxLength);
    if (cutAt > 50) {
      desc = desc.substring(0, cutAt + 1);
    } else {
      desc = desc.substring(0, maxLength) + '...';
    }
  }
  
  return desc.trim() || null;
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
    
    // Retornar tanto imagen como descripción
    return {
      image: img,
      summary: sum,
      description: extractDescription(sum)
    };
  }
  return { image: null, summary: null, description: null };
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

// ---------- API principal MODIFICADA ----------
/**
 * getImageForItem(name, category, opts)
 * Ahora retorna: { image: string, description: string|null }
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

  let result = { image: null, description: null };

  try {
    // 0) Alias directo (Wikipedia summary)
    if (alias) {
      const sumES = await fetchJSON(REST_SUMMARY('es', alias.es || alias.en || title));
      const img = pickImageFromSummary(sumES, { preferLogo: isTeam });
      const desc = extractDescription(sumES);
      
      if (img) {
        result = { image: img, description: desc };
      } else if (alias.en) {
        const sumEN = await fetchJSON(REST_SUMMARY('en', alias.en));
        const imgEN = pickImageFromSummary(sumEN, { preferLogo: isTeam });
        const descEN = extractDescription(sumEN);
        if (imgEN) {
          result = { image: imgEN, description: descEN };
        }
      }
      
      if (result.image) {
        cache.set(cacheKey, result);
        return result;
      }
    }

    if (isTeam) {
      // 1) EQUIPOS → Wikidata P154 (logo image) + descripción de Wikipedia
      const qId =
        (await wikidataSearchEntity(title, 'es')) ||
        (await wikidataSearchEntity(title, 'en'));
      
      let logoImg = null;
      if (qId) {
        const logoFile = await wikidataGetLogoFile(qId);
        if (logoFile) {
          logoImg = commonsFileURL(logoFile, 512);
        }
      }

      // Buscar descripción en Wikipedia
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
      
      const wikiResultES = await wikipediaTryQueries('es', queriesES, { preferLogo: true });
      const wikiResultEN = await wikipediaTryQueries('en', queriesEN, { preferLogo: true });
      
      result = {
        image: logoImg || wikiResultES.image || wikiResultEN.image,
        description: wikiResultES.description || wikiResultEN.description
      };
      
    } else if (normCat === 'cantantes') {
      const deezerImg = await getFromDeezerArtist(title);
      const wikiResultES = await wikipediaTryQueries('es', [title, ...HINTS.cantantes.map(h => title + h)]);
      const wikiResultEN = await wikipediaTryQueries('en', [title, ...HINTS.cantantes.map(h => title + h)]);
      
      result = {
        image: deezerImg || wikiResultES.image || wikiResultEN.image,
        description: wikiResultES.description || wikiResultEN.description
      };
      
    } else if (normCat === 'peliculas') {
      const wikiResultES = await wikipediaTryQueries('es', [title, ...HINTS.peliculas.map(h => title + h)]);
      const wikiResultEN = await wikipediaTryQueries('en', [title, ' (film)']);
      
      result = {
        image: wikiResultES.image || wikiResultEN.image,
        description: wikiResultES.description || wikiResultEN.description
      };
      
    } else if (normCat === 'fútbol') {
      // Futbolistas
      const wikiResultES = await wikipediaTryQueries('es', [title, ...HINTS.fútbol.map(h => title + h)]);
      const wikiResultEN = await wikipediaTryQueries('en', [title, ...HINTS.futbol.map(h => title + h)]);
      
      result = {
        image: wikiResultES.image || wikiResultEN.image,
        description: wikiResultES.description || wikiResultEN.description
      };
      
    } else {
      // Otros
      const wikiResultES = await wikipediaTryQueries('es', [title]);
      const wikiResultEN = await wikipediaTryQueries('en', [title]);
      
      result = {
        image: wikiResultES.image || wikiResultEN.image,
        description: wikiResultES.description || wikiResultEN.description
      };
    }
  } catch (e) {
    console.warn('getImageForItem error', e);
  }

  if (!result.image) {
    result.image = placeholderDataURI(title);
  }

  cache.set(cacheKey, result);
  return result;
}

// ---------- Función auxiliar para usar en tu UI ----------
export function formatDescription(description, name) {
  if (!description) return `Más información sobre ${name}`;
  
  // Asegurar que empiece con mayúscula
  let formatted = description.charAt(0).toUpperCase() + description.slice(1);
  
  // Asegurar que termine con punto
  if (!formatted.endsWith('.') && !formatted.endsWith('!') && !formatted.endsWith('?')) {
    formatted += '.';
  }
  
  return formatted;
}