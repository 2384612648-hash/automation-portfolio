const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

// Match every word; title matches rank ahead of description-only matches.
export function searchEntries(entries, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return entries.map((entry, index) => {
    const title = normalize(entry.title), text = normalize([entry.title, entry.detail, entry.format, entry.english, entry.url, entry.note, ...(entry.tags || [])].join(' '));
    return {entry, index, score: words.every(word => text.includes(word)) ? words.reduce((score, word) => score + (title === word ? 3 : title.includes(word) ? 2 : 0), 0) : -1};
  }).filter(item => item.score >= 0).sort((a,b) => b.score - a.score || a.index - b.index).map(item => item.entry);
}

export function readFavorites(raw, allowedIds) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter(id => typeof id === 'string' && allowedIds.includes(id)))] : [];
  } catch { return []; }
}
