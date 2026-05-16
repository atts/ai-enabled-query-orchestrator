import * as fs from 'fs';
import * as path from 'path';

import { SchemaDeltaProposal } from './types';

export type StoredProposal = SchemaDeltaProposal & {
  id: string;
  createdAt: string;
  status: 'pending' | 'pr_open' | 'applied';
  prUrl?: string;
  prBranch?: string;
};

const PROPOSALS_PATH =
  process.env.SCHEMA_PROPOSALS_PATH ||
  path.join(process.cwd(), 'schema-proposals.json');

function loadAll(): StoredProposal[] {
  if (!fs.existsSync(PROPOSALS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROPOSALS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAll(proposals: StoredProposal[]): void {
  fs.writeFileSync(PROPOSALS_PATH, JSON.stringify(proposals, null, 2));
}

/**
 * Persist a schema delta proposal to schema-proposals.json.
 * Deduplicates: if the same set of missing field names already has a pending
 * proposal, the existing one is returned without writing a duplicate.
 */
export function upsertProposal(proposal: SchemaDeltaProposal): StoredProposal {
  const existing = loadAll();

  const newFieldNames = proposal.missingFields
    .map((f) => f.name)
    .sort()
    .join(',');

  const duplicate = existing.find(
    (p) =>
      (p.status === 'pending' || p.status === 'pr_open') &&
      p.missingFields.map((f) => f.name).sort().join(',') === newFieldNames,
  );

  if (duplicate) {
    console.log(`[delta/store] Reusing existing proposal ${duplicate.id}`);
    return duplicate;
  }

  const stored: StoredProposal = {
    ...proposal,
    id: `delta-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  saveAll([...existing, stored]);
  console.log(
    `[delta/store] Saved proposal ${stored.id}: ${proposal.missingFields.map((f) => f.name).join(', ')}`,
  );
  return stored;
}

export function loadProposals(): StoredProposal[] {
  return loadAll();
}

/**
 * Mark a proposal as having an open PR.
 * Called after GitHub API successfully creates a PR for the proposal.
 */
export function markPrCreated(
  proposalId: string,
  prUrl: string,
  prBranch: string,
): StoredProposal | null {
  const all = loadAll();
  const idx = all.findIndex((p) => p.id === proposalId);
  if (idx === -1) return null;

  all[idx] = { ...all[idx], status: 'pr_open', prUrl, prBranch };
  saveAll(all);
  console.log(`[delta/store] Proposal ${proposalId} → pr_open: ${prUrl}`);
  return all[idx];
}
