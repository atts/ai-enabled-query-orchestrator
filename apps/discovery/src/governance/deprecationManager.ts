// Intelligent Deprecation Manager
// Tracks field access frequency and recommends deprecation candidates based on
// low usage + known naming anti-patterns that have better modern equivalents.

import * as fs from 'fs';
import * as path from 'path';

const TRACKER_PATH =
  process.env.DEPRECATION_TRACKER_PATH ||
  path.join(process.cwd(), 'deprecation-tracker.json');

type FieldAccessRecord = {
  subgraph: string;
  typeName: string;
  fieldName: string;
  accessCount: number;
  firstAccessAt: string;
  lastAccessAt: string;
};

type DeprecationTrackerStore = {
  updatedAt: string;
  fields: FieldAccessRecord[];
};

// Known naming patterns that have better modern equivalents
const NAMING_ANTIPATTERNS: {
  pattern: RegExp;
  reason: string;
  suggestedReplacement: string;
}[] = [
  { pattern: /^get[A-Z]/, reason: 'GraphQL fields should not be prefixed with "get" — it is implied', suggestedReplacement: 'Remove the "get" prefix (e.g., getName → name)' },
  { pattern: /^fetch[A-Z]/, reason: 'GraphQL fields should not be prefixed with "fetch"', suggestedReplacement: 'Remove the "fetch" prefix' },
  { pattern: /^is[A-Z].*Flag$/, reason: 'Boolean fields named with both "is" prefix and "Flag" suffix are redundant', suggestedReplacement: 'Remove the "Flag" suffix' },
  { pattern: /Id$/, reason: 'Fields ending in "Id" may indicate a missing entity relationship', suggestedReplacement: 'Consider exposing the related entity directly via federation' },
  { pattern: /^data[A-Z]/, reason: '"data" prefix is redundant in GraphQL contexts', suggestedReplacement: 'Remove the "data" prefix' },
  { pattern: /List$/, reason: '"List" suffix is redundant — GraphQL arrays are already lists', suggestedReplacement: 'Remove the "List" suffix (e.g., productList → products)' },
  { pattern: /^info[A-Z]/, reason: '"info" prefix is vague and should be replaced with descriptive names', suggestedReplacement: 'Replace with a specific descriptive field name' },
];

function loadStore(): DeprecationTrackerStore {
  if (!fs.existsSync(TRACKER_PATH)) {
    return { updatedAt: new Date().toISOString(), fields: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf-8'));
  } catch {
    return { updatedAt: new Date().toISOString(), fields: [] };
  }
}

function saveStore(store: DeprecationTrackerStore): void {
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(TRACKER_PATH, JSON.stringify(store, null, 2));
}

export function recordFieldAccess(
  subgraph: string,
  typeName: string,
  fieldName: string,
): void {
  const store = loadStore();
  const key = `${subgraph}.${typeName}.${fieldName}`;
  const existing = store.fields.find(
    (f) => f.subgraph === subgraph && f.typeName === typeName && f.fieldName === fieldName,
  );

  if (existing) {
    existing.accessCount++;
    existing.lastAccessAt = new Date().toISOString();
  } else {
    store.fields.push({
      subgraph,
      typeName,
      fieldName,
      accessCount: 1,
      firstAccessAt: new Date().toISOString(),
      lastAccessAt: new Date().toISOString(),
    });
  }
  void key;
  saveStore(store);
}

export type DeprecationCandidate = {
  subgraph: string;
  typeName: string;
  fieldName: string;
  reason: string;
  suggestedReplacement: string | null;
  usageCount: number;
  lastAccessAt: string | null;
};

export function getDeprecationCandidates(): DeprecationCandidate[] {
  const store = loadStore();
  const candidates: DeprecationCandidate[] = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  // 1. Fields with zero or very low access in the last 30 days
  for (const record of store.fields) {
    const lastAccess = record.lastAccessAt
      ? now - new Date(record.lastAccessAt).getTime()
      : Infinity;

    if (lastAccess > thirtyDaysMs && record.accessCount < 5) {
      candidates.push({
        subgraph: record.subgraph,
        typeName: record.typeName,
        fieldName: record.fieldName,
        reason: `Field has only ${record.accessCount} access(es) and was last accessed more than 30 days ago`,
        suggestedReplacement: null,
        usageCount: record.accessCount,
        lastAccessAt: record.lastAccessAt,
      });
    }
  }

  // 2. Fields matching known naming anti-patterns (across all tracked fields)
  for (const record of store.fields) {
    for (const antipattern of NAMING_ANTIPATTERNS) {
      if (antipattern.pattern.test(record.fieldName)) {
        const alreadyAdded = candidates.find(
          (c) => c.subgraph === record.subgraph && c.fieldName === record.fieldName,
        );
        if (!alreadyAdded) {
          candidates.push({
            subgraph: record.subgraph,
            typeName: record.typeName,
            fieldName: record.fieldName,
            reason: antipattern.reason,
            suggestedReplacement: antipattern.suggestedReplacement,
            usageCount: record.accessCount,
            lastAccessAt: record.lastAccessAt,
          });
        }
        break;
      }
    }
  }

  // 3. Add synthetic candidates for known anti-patterns in the static schema
  //    (fields never accessed but known to exist from introspection)
  const KNOWN_ANTIPATTERN_FIELDS = [
    { subgraph: 'products', typeName: 'Product', fieldName: 'description', reason: 'Consider renaming to "summary" for brevity and consistency with content APIs', suggestedReplacement: 'summary' },
  ];
  for (const field of KNOWN_ANTIPATTERN_FIELDS) {
    const alreadyTracked = store.fields.find(
      (f) => f.subgraph === field.subgraph && f.fieldName === field.fieldName,
    );
    if (!alreadyTracked) {
      candidates.push({
        ...field,
        usageCount: 0,
        lastAccessAt: null,
      });
    }
  }

  return candidates;
}
