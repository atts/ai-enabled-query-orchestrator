// Anomaly Detection
// Tracks request patterns in memory and flags unusual behavior:
//   - Sudden spikes in request rate for a specific query pattern
//   - Brand-new field combinations that have never been seen before
//   - Off-hours access to PII-adjacent fields
// State is in-memory only (resets on service restart).

const PII_FIELD_NAMES = new Set([
  'email', 'emailAddress', 'phone', 'phoneNumber', 'address', 'street',
  'ssn', 'password', 'creditCard', 'cardNumber', 'dateOfBirth', 'salary',
]);

type RequestRecord = {
  fingerprint: string;
  fields: string[];
  prompt: string;
  timestamp: number;
};

type FingerprintStats = {
  count: number;
  firstSeen: number;
  lastSeen: number;
  recentTimestamps: number[];
};

// ─── Module-level singleton state ────────────────────────────────────────────

const requestHistory: RequestRecord[] = [];
const fingerprintStats: Map<string, FingerprintStats> = new Map();
const MAX_HISTORY = 1000;

// ─── Fingerprinting ───────────────────────────────────────────────────────────

function fingerprint(fields: string[]): string {
  return [...fields].sort().join('|');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function trackRequest(prompt: string, fields: string[]): void {
  const fp = fingerprint(fields);
  const now = Date.now();

  // Update stats
  const stats = fingerprintStats.get(fp) ?? {
    count: 0,
    firstSeen: now,
    lastSeen: now,
    recentTimestamps: [],
  };
  stats.count++;
  stats.lastSeen = now;
  stats.recentTimestamps.push(now);
  // Keep only last 60 timestamps for rate calculation
  if (stats.recentTimestamps.length > 60) stats.recentTimestamps.shift();
  fingerprintStats.set(fp, stats);

  // Add to history
  requestHistory.push({ fingerprint: fp, fields, prompt, timestamp: now });
  if (requestHistory.length > MAX_HISTORY) requestHistory.shift();
}

export type QueryAnomaly = {
  id: string;
  detectedAt: string;
  pattern: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  querySnapshot: string;
};

export type AnomalyReport = {
  generatedAt: string;
  totalRequests: number;
  windowMinutes: number;
  anomalies: QueryAnomaly[];
  summary: string;
};

export function getAnomalyReport(): AnomalyReport {
  const generatedAt = new Date().toISOString();
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // analyze last 1 hour
  const anomalies: QueryAnomaly[] = [];

  const recentRequests = requestHistory.filter((r) => now - r.timestamp < windowMs);

  // ── Anomaly 1: Rate spike ─────────────────────────────────────────────────
  // A fingerprint with 5+ requests in the last 5 minutes when average is < 2/min
  const fiveMinMs = 5 * 60 * 1000;
  for (const [fp, stats] of fingerprintStats.entries()) {
    const recentCount = stats.recentTimestamps.filter((t) => now - t < fiveMinMs).length;
    const historicalRate = stats.count / Math.max(1, (now - stats.firstSeen) / 60000); // per minute
    if (recentCount >= 5 && historicalRate < 2) {
      anomalies.push({
        id: `spike-${fp.slice(0, 8)}-${Date.now()}`,
        detectedAt: generatedAt,
        pattern: 'REQUEST_SPIKE',
        severity: recentCount >= 20 ? 'CRITICAL' : recentCount >= 10 ? 'HIGH' : 'MEDIUM',
        description: `Query pattern "${fp.slice(0, 40)}..." received ${recentCount} requests in the last 5 minutes (historical average: ${historicalRate.toFixed(1)}/min). Possible scraping or runaway client.`,
        querySnapshot: fp,
      });
    }
  }

  // ── Anomaly 2: New field combination never seen before ────────────────────
  const brandNew = recentRequests.filter((r) => {
    const stats = fingerprintStats.get(r.fingerprint);
    return stats && stats.count === 1 && stats.firstSeen === stats.lastSeen;
  });
  if (brandNew.length > 3) {
    anomalies.push({
      id: `new-combos-${Date.now()}`,
      detectedAt: generatedAt,
      pattern: 'NOVEL_FIELD_COMBINATIONS',
      severity: 'LOW',
      description: `${brandNew.length} unique new query patterns detected in the last hour that have never been seen before. This may indicate exploratory clients or a new integration.`,
      querySnapshot: brandNew.slice(0, 3).map((r) => r.fingerprint.slice(0, 40)).join(' | '),
    });
  }

  // ── Anomaly 3: PII field access ───────────────────────────────────────────
  const piiRequests = recentRequests.filter((r) =>
    r.fields.some((f) => PII_FIELD_NAMES.has(f)),
  );
  if (piiRequests.length > 0) {
    const hour = new Date().getHours();
    const isOffHours = hour < 6 || hour > 22;
    anomalies.push({
      id: `pii-access-${Date.now()}`,
      detectedAt: generatedAt,
      pattern: isOffHours ? 'OFF_HOURS_PII_ACCESS' : 'PII_FIELD_ACCESS',
      severity: isOffHours ? 'HIGH' : 'MEDIUM',
      description: `${piiRequests.length} request(s) in the last hour accessed PII-adjacent fields: ${[...new Set(piiRequests.flatMap((r) => r.fields.filter((f) => PII_FIELD_NAMES.has(f))))].join(', ')}.${isOffHours ? ' Access occurred outside business hours — review for unauthorized access.' : ''}`,
      querySnapshot: piiRequests[0]?.fingerprint.slice(0, 80) ?? '',
    });
  }

  // ── Anomaly 4: Unusually deep/broad queries ───────────────────────────────
  const broadQueries = recentRequests.filter((r) => r.fields.length > 15);
  if (broadQueries.length > 0) {
    anomalies.push({
      id: `broad-query-${Date.now()}`,
      detectedAt: generatedAt,
      pattern: 'OVERLY_BROAD_QUERY',
      severity: 'MEDIUM',
      description: `${broadQueries.length} request(s) requested more than 15 fields. The broadest requested ${Math.max(...broadQueries.map((r) => r.fields.length))} fields. Consider implementing query complexity limits.`,
      querySnapshot: broadQueries[0]?.fingerprint.slice(0, 80) ?? '',
    });
  }

  const summary =
    anomalies.length === 0
      ? `No anomalies detected in the last hour. ${recentRequests.length} request(s) analyzed.`
      : `${anomalies.length} anomaly(ies) detected across ${recentRequests.length} request(s) in the last hour. Review ${anomalies.filter((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL').length} high/critical item(s) immediately.`;

  return {
    generatedAt,
    totalRequests: recentRequests.length,
    windowMinutes: 60,
    anomalies,
    summary,
  };
}
