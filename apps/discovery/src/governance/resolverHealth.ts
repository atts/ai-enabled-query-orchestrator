// Resolver Health Tracker
// Tracks resolver errors in-memory and generates health reports with
// automated root-cause suggestions based on known error patterns.
// State is in-memory only (resets on service restart).

type ErrorRecord = {
  subgraph: string;
  field: string;
  count: number;
  lastError: string;
  lastErrorAt: string;
  errorHistory: { error: string; at: string }[];
};

// ─── Known error → fix suggestions ───────────────────────────────────────────

const FIX_PATTERNS: { pattern: RegExp; fix: string }[] = [
  {
    pattern: /null|undefined|cannot read/i,
    fix: 'Add null-safety: check that the parent object and data source are defined before accessing nested properties.',
  },
  {
    pattern: /timeout|ETIMEDOUT|ECONNABORTED/i,
    fix: 'Data source is timing out. Add a cache layer (e.g., Redis/Memcached) or increase the timeout. Consider circuit breaker pattern.',
  },
  {
    pattern: /ECONNREFUSED|connection refused|ENOTFOUND/i,
    fix: 'Cannot connect to data source. Check that the dependency service is running and the host/port config is correct.',
  },
  {
    pattern: /unauthorized|401|forbidden|403|permission/i,
    fix: 'Authorization failure. Verify the service account credentials and ensure the resolver has the correct IAM permissions.',
  },
  {
    pattern: /not found|404|no rows|zero result/i,
    fix: 'Resource not found. Ensure the resolver handles missing records gracefully — return null instead of throwing.',
  },
  {
    pattern: /rate limit|429|too many request/i,
    fix: 'Upstream rate limit hit. Implement exponential backoff, request queuing, or a caching layer to reduce call frequency.',
  },
  {
    pattern: /syntax|parse|invalid query|schema/i,
    fix: 'Query or schema issue. Check that the resolver\'s database query matches the current schema version.',
  },
  {
    pattern: /memory|heap|out of memory/i,
    fix: 'Memory pressure detected. Add pagination (first/after args) to prevent loading unbounded result sets.',
  },
];

// ─── Module-level singleton ───────────────────────────────────────────────────

const errorLog: Map<string, ErrorRecord> = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

export function trackResolverError(
  subgraph: string,
  field: string,
  error: string,
): void {
  const key = `${subgraph}.${field}`;
  const now = new Date().toISOString();
  const existing = errorLog.get(key);

  if (existing) {
    existing.count++;
    existing.lastError = error;
    existing.lastErrorAt = now;
    existing.errorHistory.push({ error, at: now });
    if (existing.errorHistory.length > 10) existing.errorHistory.shift();
  } else {
    errorLog.set(key, {
      subgraph,
      field,
      count: 1,
      lastError: error,
      lastErrorAt: now,
      errorHistory: [{ error, at: now }],
    });
  }
  console.log(`[resolverHealth] Error tracked: ${subgraph}.${field} (total: ${errorLog.get(key)!.count})`);
}

function suggestFix(error: string): string {
  for (const { pattern, fix } of FIX_PATTERNS) {
    if (pattern.test(error)) return fix;
  }
  return 'No automated fix suggestion available. Check the stack trace and resolver implementation.';
}

export type FieldHealth = {
  subgraph: string;
  fieldName: string;
  errorCount: number;
  lastError: string;
  lastErrorAt: string;
  suggestedFix: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
};

export type ResolverHealthReport = {
  generatedAt: string;
  totalErrors: number;
  healthySubgraphs: string[];
  affectedFields: FieldHealth[];
  summary: string;
};

export function getResolverHealthReport(): ResolverHealthReport {
  const generatedAt = new Date().toISOString();
  const affectedFields: FieldHealth[] = [];

  for (const record of errorLog.values()) {
    affectedFields.push({
      subgraph: record.subgraph,
      fieldName: record.field,
      errorCount: record.count,
      lastError: record.lastError,
      lastErrorAt: record.lastErrorAt,
      suggestedFix: suggestFix(record.lastError),
      status: record.count >= 10 ? 'CRITICAL' : record.count >= 3 ? 'DEGRADED' : 'HEALTHY',
    });
  }

  affectedFields.sort((a, b) => b.errorCount - a.errorCount);

  const totalErrors = affectedFields.reduce((sum, f) => sum + f.errorCount, 0);
  const criticalCount = affectedFields.filter((f) => f.status === 'CRITICAL').length;
  const affectedSubgraphs = new Set(affectedFields.map((f) => f.subgraph));
  const allSubgraphs = ['products', 'inventory', 'cart', 'discovery'];
  const healthySubgraphs = allSubgraphs.filter((s) => !affectedSubgraphs.has(s));

  const summary =
    affectedFields.length === 0
      ? 'All resolvers healthy. No errors recorded since last restart.'
      : `${totalErrors} total error(s) across ${affectedFields.length} field(s). ${criticalCount > 0 ? `${criticalCount} field(s) in CRITICAL state — immediate action required.` : 'No critical failures.'}`;

  return { generatedAt, totalErrors, healthySubgraphs, affectedFields, summary };
}
