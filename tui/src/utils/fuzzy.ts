/**
 * Simple fuzzy matching - returns score 0-100.
 * Higher score = better match.
 */
export function fuzzyMatch(query: string, target: string): number {
  if (!query) return 100;
  if (!target) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match bonus
  if (t === q) return 100;

  // Starts with bonus
  if (t.startsWith(q)) return 90;

  // Contains bonus
  if (t.includes(q)) return 70;

  // Fuzzy character matching
  let queryIdx = 0;
  let score = 0;
  let consecutiveBonus = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < t.length && queryIdx < q.length; i++) {
    if (t[i] === q[queryIdx]) {
      score += 10 + consecutiveBonus;

      // Bonus for matches at word boundaries
      if (i === 0 || t[i - 1] === " " || t[i - 1] === "-" || t[i - 1] === "_") {
        score += 5;
      }

      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        consecutiveBonus = Math.min(consecutiveBonus + 5, 20);
      } else {
        consecutiveBonus = 0;
      }

      lastMatchIdx = i;
      queryIdx++;
    } else {
      consecutiveBonus = 0;
    }
  }

  // All query characters must be found
  if (queryIdx < q.length) return 0;

  // Bonus for shorter targets (more relevant matches)
  score += Math.max(0, 30 - t.length);

  return Math.min(score, 100);
}

/**
 * Filter and sort items by fuzzy match score.
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  if (!query.trim()) return items;

  return items
    .map((item) => ({
      item,
      score: fuzzyMatch(query, getText(item)),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
