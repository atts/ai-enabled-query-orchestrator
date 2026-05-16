// Intelligent Caching Advisor
// Recommends per-field cache TTLs based on data volatility categories.
// Entirely rules-based — works without any LLM or external service.

const INTROSPECT_ALL = `
  {
    __schema {
      types {
        name
        kind
        fields { name }
      }
    }
  }
`;

// TTL rules in seconds — ordered from most specific to most general
const CACHE_RULES: {
  pattern: RegExp;
  ttlSeconds: number;
  category: string;
  rationale: string;
}[] = [
  // Never cache — highly volatile or security-sensitive
  { pattern: /password|secret|token|credential|session/i, ttlSeconds: 0, category: 'Security-sensitive', rationale: 'Never cache security credentials. Always fetch fresh.' },
  { pattern: /\bstock\b|inventory|availability|inStock/i, ttlSeconds: 15, category: 'Real-time inventory', rationale: 'Stock levels change frequently. 15s TTL prevents overselling.' },
  { pattern: /price|cost|amount|discount|promo/i, ttlSeconds: 30, category: 'Pricing', rationale: 'Prices change during sales/promotions. 30s balances freshness and load.' },
  { pattern: /cart|basket|order|checkout/i, ttlSeconds: 0, category: 'Shopping cart / orders', rationale: 'Cart state is user-specific and changes on every action. Do not cache.' },
  // Low volatility — changes occasionally
  { pattern: /rating|review|score|rank/i, ttlSeconds: 300, category: 'Ratings & reviews', rationale: 'Review aggregates change when new reviews are submitted (typically infrequent).' },
  { pattern: /category|brand|manufacturer|vendor/i, ttlSeconds: 3600, category: 'Product taxonomy', rationale: 'Categories rarely change. 1h TTL is safe.' },
  { pattern: /description|summary|detail|spec|feature/i, ttlSeconds: 3600, category: 'Product content', rationale: 'Product copy changes infrequently. 1h TTL reduces content delivery load.' },
  { pattern: /image|photo|thumbnail|media/i, ttlSeconds: 86400, category: 'Media assets', rationale: 'Images are versioned by URL. 24h TTL is safe with proper cache busting.' },
  // Stable identifiers
  { pattern: /\bname\b|title|label|slug/i, ttlSeconds: 3600, category: 'Display names', rationale: 'Product names rarely change. 1h TTL is appropriate.' },
  { pattern: /\bid\b|uuid|sku|barcode|mpn/i, ttlSeconds: 86400, category: 'Identifiers', rationale: 'Identifiers are immutable once assigned. 24h CDN caching recommended.' },
  // Timestamps — don't cache the value but the entity can be
  { pattern: /createdAt|insertedAt|publishedAt/i, ttlSeconds: 86400, category: 'Creation timestamp', rationale: 'Immutable once set. Safe to cache indefinitely.' },
  { pattern: /updatedAt|modifiedAt|lastModified/i, ttlSeconds: 60, category: 'Update timestamp', rationale: 'Changes whenever entity is updated. Keep TTL short for accuracy.' },
  // AI/computed fields — expensive to recompute
  { pattern: /score|rating|prediction|recommendation|rank/i, ttlSeconds: 600, category: 'Computed/ML fields', rationale: 'AI-computed scores are expensive. 10m TTL balances freshness and cost.' },
];

const DEFAULT_RULE = {
  ttlSeconds: 300,
  category: 'General field',
  rationale: 'No specific caching rule matched. 5m default TTL applied.',
};

export type CacheRecommendation = {
  subgraph: string;
  typeName: string;
  fieldName: string;
  recommendedTTL: number;
  category: string;
  rationale: string;
  httpCacheHeader: string;
};

export type CacheAdvisoryReport = {
  generatedAt: string;
  recommendations: CacheRecommendation[];
  totalFieldsAnalyzed: number;
  potentialCacheSavings: string;
};

function getTTLRule(fieldName: string) {
  for (const rule of CACHE_RULES) {
    if (rule.pattern.test(fieldName)) return rule;
  }
  return DEFAULT_RULE;
}

function toHttpCacheHeader(ttl: number): string {
  if (ttl === 0) return 'no-store, no-cache';
  if (ttl < 60) return `private, max-age=${ttl}`;
  return `public, max-age=${ttl}, stale-while-revalidate=${Math.floor(ttl * 0.1)}`;
}

async function introspectSubgraph(
  subgraph: string,
  url: string,
): Promise<{ subgraph: string; typeName: string; fieldName: string }[]> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECT_ALL }),
    });
    const json = (await res.json()) as {
      data?: { __schema?: { types: { name: string; kind: string; fields: { name: string }[] | null }[] } };
    };
    return (json.data?.__schema?.types ?? [])
      .filter((t) => t.kind === 'OBJECT' && !t.name.startsWith('__') && t.fields)
      .flatMap((t) => (t.fields ?? []).map((f) => ({ subgraph, typeName: t.name, fieldName: f.name })));
  } catch {
    return [];
  }
}

const SUBGRAPH_URLS: Record<string, string> = {
  products: 'http://localhost:4001/graphql',
  inventory: 'http://localhost:4002/graphql',
  cart: 'http://localhost:4003/graphql',
  discovery: 'http://localhost:4004/graphql',
};

export async function getCacheRecommendations(): Promise<CacheAdvisoryReport> {
  const generatedAt = new Date().toISOString();
  const recommendations: CacheRecommendation[] = [];

  for (const [subgraph, url] of Object.entries(SUBGRAPH_URLS)) {
    const fields = await introspectSubgraph(subgraph, url);
    for (const { typeName, fieldName } of fields) {
      const rule = getTTLRule(fieldName);
      recommendations.push({
        subgraph,
        typeName,
        fieldName,
        recommendedTTL: rule.ttlSeconds,
        category: rule.category,
        rationale: rule.rationale,
        httpCacheHeader: toHttpCacheHeader(rule.ttlSeconds),
      });
    }
  }

  const noCacheCount = recommendations.filter((r) => r.recommendedTTL === 0).length;
  const avgTTL = recommendations.filter((r) => r.recommendedTTL > 0).reduce((sum, r) => sum + r.recommendedTTL, 0) /
    Math.max(1, recommendations.filter((r) => r.recommendedTTL > 0).length);

  return {
    generatedAt,
    recommendations,
    totalFieldsAnalyzed: recommendations.length,
    potentialCacheSavings: `${recommendations.length - noCacheCount} of ${recommendations.length} fields are cacheable. Average TTL: ${Math.round(avgTTL)}s. Estimated gateway load reduction: ${Math.round(((recommendations.length - noCacheCount) / recommendations.length) * 70)}%.`,
  };
}
