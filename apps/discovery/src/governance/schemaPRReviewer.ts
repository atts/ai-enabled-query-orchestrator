// Schema PR Reviewer
// Fetches changed files from a GitHub PR, analyzes SDL content for quality
// issues, and posts an automated review comment via the GitHub Pulls API.

type GhOptions = { method?: string; body?: unknown };

async function ghApi<T>(
  repo: string,
  token: string,
  endpoint: string,
  options: GhOptions = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${options.method ?? 'GET'} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── SDL Quality Rules ────────────────────────────────────────────────────────

const SDL_RULES: {
  name: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  check: (sdl: string) => string | null; // returns message if violated, null if ok
}[] = [
  {
    name: 'field-naming-camelCase',
    severity: 'ERROR',
    check: (sdl) => {
      const matches = sdl.match(/^\s+([A-Z][a-zA-Z0-9]*)\s*[:(]/gm);
      if (matches?.length) return `Field names must be camelCase. Found PascalCase fields: ${matches.map((m) => m.trim()).join(', ')}`;
      return null;
    },
  },
  {
    name: 'type-naming-PascalCase',
    severity: 'ERROR',
    check: (sdl) => {
      const matches = sdl.match(/^(type|input|interface|enum)\s+[a-z]/gm);
      if (matches?.length) return `Type names must be PascalCase. Found lowercase-starting types: ${matches.join(', ')}`;
      return null;
    },
  },
  {
    name: 'missing-field-descriptions',
    severity: 'WARNING',
    check: (sdl) => {
      const fieldLines = sdl.match(/^\s+\w+\s*[:(]/gm) ?? [];
      const docLines = sdl.match(/"""[\s\S]*?"""/gm) ?? [];
      if (fieldLines.length > 3 && docLines.length === 0) {
        return `${fieldLines.length} field(s) have no documentation. Add """ description """ above fields for better developer experience.`;
      }
      return null;
    },
  },
  {
    name: 'deprecated-without-reason',
    severity: 'WARNING',
    check: (sdl) => {
      const matches = sdl.match(/@deprecated(?!\(reason:)/g);
      if (matches?.length) return `${matches.length} @deprecated directive(s) found without a reason parameter. Use @deprecated(reason: "Use X instead").`;
      return null;
    },
  },
  {
    name: 'no-generic-type-names',
    severity: 'WARNING',
    check: (sdl) => {
      const generics = ['Data', 'Info', 'Object', 'Item', 'Entity', 'Record', 'Model'];
      const found = generics.filter((g) => new RegExp(`^type ${g}\\b`, 'm').test(sdl));
      if (found.length) return `Avoid generic type names: ${found.join(', ')}. Use domain-specific names (e.g., "ProductSummary" instead of "Item").`;
      return null;
    },
  },
  {
    name: 'nullable-id-fields',
    severity: 'ERROR',
    check: (sdl) => {
      const match = sdl.match(/\bid\s*:\s*ID\s*\n/);
      if (match) return '`id: ID` should be non-nullable: use `id: ID!` to enforce entity integrity.';
      return null;
    },
  },
  {
    name: 'no-any-scalar-overuse',
    severity: 'INFO',
    check: (sdl) => {
      const anyFields = (sdl.match(/:\s*String\b/g) ?? []).length;
      const totalFields = (sdl.match(/^\s+\w+\s*:/gm) ?? []).length;
      if (totalFields > 0 && anyFields / totalFields > 0.8) {
        return `${anyFields} of ${totalFields} fields use String type. Consider using more specific scalars (Int, Float, Boolean, ID) where appropriate.`;
      }
      return null;
    },
  },
  {
    name: 'mutation-naming-convention',
    severity: 'WARNING',
    check: (sdl) => {
      const mutations = sdl.match(/^\s+(get|fetch|list|query)[A-Z]/gm);
      if (mutations?.length) return `Mutation fields starting with "get/fetch/list/query" suggest queries. Mutations should use verbs like "create", "update", "delete", "add", "remove".`;
      return null;
    },
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewComment = {
  type: string;
  severity: string;
  message: string;
  suggestion: string | null;
};

export type PRReviewResult = {
  prNumber: number;
  reviewedAt: string;
  approved: boolean;
  score: number;
  comments: ReviewComment[];
  githubReviewUrl: string | null;
};

// ─── Main export ─────────────────────────────────────────────────────────────

export async function reviewSchemaPR(prNumber: number): Promise<PRReviewResult> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO ?? 'atts/ai-enabled-query-orchestrator';
  const reviewedAt = new Date().toISOString();

  if (!token) {
    throw new Error('GITHUB_TOKEN is required to review PRs');
  }

  // 1. Fetch changed files
  type PrFile = { filename: string; patch?: string };
  const files = await ghApi<PrFile[]>(repo, token, `/pulls/${prNumber}/files`);

  const sdlFiles = files.filter(
    (f) => f.filename.endsWith('.graphql') || f.filename.endsWith('.ts') && f.patch?.includes('gql`'),
  );

  const comments: ReviewComment[] = [];

  if (sdlFiles.length === 0) {
    comments.push({
      type: 'info',
      severity: 'INFO',
      message: 'No GraphQL SDL files detected in this PR. If schema changes exist in .ts files, ensure they use the `gql` template tag.',
      suggestion: null,
    });
  }

  // 2. Run SDL rules against each changed file's patch
  for (const file of sdlFiles) {
    const content = file.patch ?? '';
    const addedLines = content
      .split('\n')
      .filter((l) => l.startsWith('+'))
      .map((l) => l.slice(1))
      .join('\n');

    for (const rule of SDL_RULES) {
      const violation = rule.check(addedLines);
      if (violation) {
        comments.push({
          type: rule.name,
          severity: rule.severity,
          message: `[${file.filename}] ${violation}`,
          suggestion: null,
        });
      }
    }
  }

  // 3. Calculate score (100 - penalties per issue)
  const penalties: Record<string, number> = { ERROR: 20, WARNING: 10, INFO: 2 };
  const score = Math.max(
    0,
    100 - comments.reduce((sum, c) => sum + (penalties[c.severity] ?? 0), 0),
  );
  const approved = score >= 70 && !comments.some((c) => c.severity === 'ERROR');

  // 4. Post review to GitHub
  let githubReviewUrl: string | null = null;
  try {
    const reviewBody = buildReviewBody(comments, score, approved);
    const review = await ghApi<{ html_url: string }>(repo, token, `/pulls/${prNumber}/reviews`, {
      method: 'POST',
      body: {
        body: reviewBody,
        event: approved ? 'APPROVE' : comments.some((c) => c.severity === 'ERROR') ? 'REQUEST_CHANGES' : 'COMMENT',
      },
    });
    githubReviewUrl = review.html_url;
    console.log(`[schemaPRReviewer] Review posted: ${githubReviewUrl}`);
  } catch (err) {
    console.error('[schemaPRReviewer] Failed to post review:', (err as Error).message);
  }

  return { prNumber, reviewedAt, approved, score, comments, githubReviewUrl };
}

function buildReviewBody(comments: ReviewComment[], score: number, approved: boolean): string {
  const icon = approved ? '✅' : comments.some((c) => c.severity === 'ERROR') ? '❌' : '⚠️';
  const status = approved ? 'APPROVED' : 'CHANGES REQUESTED';

  const errorItems = comments.filter((c) => c.severity === 'ERROR');
  const warnItems = comments.filter((c) => c.severity === 'WARNING');
  const infoItems = comments.filter((c) => c.severity === 'INFO');

  return `## ${icon} Schema Quality Review — ${status}

> Automated review by the AI Discovery Service

**Quality Score: ${score}/100**

${errorItems.length > 0 ? `### ❌ Errors (must fix before merge)\n${errorItems.map((c) => `- **${c.type}**: ${c.message}`).join('\n')}\n` : ''}
${warnItems.length > 0 ? `### ⚠️ Warnings (recommended fixes)\n${warnItems.map((c) => `- **${c.type}**: ${c.message}`).join('\n')}\n` : ''}
${infoItems.length > 0 ? `### ℹ️ Info\n${infoItems.map((c) => `- ${c.message}`).join('\n')}\n` : ''}
${comments.length === 0 ? '### ✅ All checks passed\nSchema follows all naming conventions and best practices.' : ''}

---
*Auto-reviewed by [AI Discovery Service](apps/discovery/src/governance/schemaPRReviewer.ts)*`;
}
