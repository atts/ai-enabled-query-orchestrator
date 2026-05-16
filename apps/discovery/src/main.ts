import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

import { generatePlan } from './ai/planner';
import { validatePlan } from './ai/validator';
import { detectMissingFields } from './ai/delta/detector';
import { proposeProductSchemaDelta } from './ai/delta/proposer';
import {
  upsertProposal,
  loadProposals,
  markPrCreated,
} from './ai/delta/store';
import { createSchemaDeltaPR } from './github/prCreator';
import { getProductFields } from './execution/schemaIntrospection';
import { buildProductsQuery, buildVariables } from './execution/queryBuilder';
import { executeQuery } from './execution/executor';

// ── Governance modules ─────────────────────────────────────────────────────
import { scanSchemaForPII } from './governance/piiScanner';
import { explainQuery, analyzeQueryCost } from './governance/queryAnalyzer';
import { checkSchemaConsistency } from './governance/consistencyChecker';
import {
  recordFieldAccess,
  getDeprecationCandidates,
} from './governance/deprecationManager';
import { getCacheRecommendations } from './governance/cachingAdvisor';
import {
  trackRequest,
  getAnomalyReport,
} from './governance/anomalyDetector';
import {
  trackResolverError,
  getResolverHealthReport,
} from './governance/resolverHealth';
import { reviewSchemaPR } from './governance/schemaPRReviewer';
import { generateFullResolvers } from './ai/resolverGenerator';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000/graphql';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.0"
      import: ["@key", "@external"]
    )

  # ── Core search types ──────────────────────────────────────────────────────

  type Query {
    aiSearch(prompt: String!): AiSearchResponse!
    """
    Returns all schema proposals queued for developer review.
    """
    pendingSchemaProposals: [SchemaProposal!]!

    # ── Query Intelligence ──────────────────────────────────────────────────
    """
    Returns a plain-English explanation of any GraphQL query including which
    subgraphs are involved, complexity, and federation jumps.
    """
    explainQuery(query: String!): QueryExplanation!

    """
    Estimates the cost of executing a GraphQL query: field count, nesting
    depth, federation jumps, and an overall risk level.
    """
    analyzeQueryCost(query: String!): CostAnalysis!

    # ── Compliance ─────────────────────────────────────────────────────────
    """
    Scans all subgraph schemas for fields that likely contain personally
    identifiable information, with GDPR/CCPA remediation guidance.
    """
    scanSchemaForPII: PIIReport!

    # ── Schema Governance ──────────────────────────────────────────────────
    """
    Checks whether the same semantic concept is named differently across
    subgraphs (e.g. 'price' vs 'cost' vs 'unitCost').
    """
    checkSchemaConsistency: ConsistencyReport!

    """
    Returns fields that have low or zero recorded usage and may be candidates
    for deprecation, along with a reason and last-seen date.
    """
    deprecationCandidates: [DeprecationCandidate!]!

    """
    Returns per-field TTL recommendations based on the type of data each
    field contains (e.g. stock → 15s, description → 3600s).
    """
    cacheRecommendations: [CacheRecommendation!]!

    # ── Observability ──────────────────────────────────────────────────────
    """
    Returns a report of detected query anomalies: rate spikes, novel field
    combinations, PII field access, and overly broad queries.
    """
    anomalyReport: AnomalyReport!

    """
    Returns the health of every tracked resolver: error counts, last error
    message, and a suggested fix for the most common error pattern.
    """
    resolverHealth: ResolverHealthReport!
  }

  type Mutation {
    """
    Manually trigger PR creation for an existing proposal that doesn't have one yet.
    Requires GITHUB_TOKEN and GITHUB_REPO to be set in .env.
    """
    createSchemaDeltaPR(proposalId: String!): SchemaProposal!

    """
    Generates complete TypeScript resolver code with realistic mock data for
    a saved schema proposal. Returns code ready to drop into the subgraph.
    """
    generateFullResolvers(proposalId: String!): GeneratedResolvers!

    """
    Fetches a GitHub PR, analyses the SDL changes for quality issues (naming
    conventions, missing descriptions, deprecated fields without replacement),
    and posts a review comment with a score.
    Requires GITHUB_TOKEN and GITHUB_REPO to be set in .env.
    """
    reviewSchemaPR(prNumber: Int!): PRReviewResult!

    """
    Record that a resolver threw an error. The health report will surface
    these with suggested fixes.
    """
    trackResolverError(
      subgraph: String!
      field: String!
      error: String!
    ): Boolean!

    """
    Record that a field was accessed. Used by the deprecation manager to
    track which fields have recent usage.
    """
    recordFieldAccess(
      subgraph: String!
      typeName: String!
      fieldName: String!
    ): Boolean!
  }

  # ── Schema proposal types ──────────────────────────────────────────────────

  type AiSearchResponse {
    results: [SearchResult!]!
    """
    Present when the AI requested fields that don't exist in the schema yet.
    The proposal has been persisted and a GitHub PR opened automatically.
    Results are still returned using the fields that already exist.
    """
    pendingProposal: SchemaProposal
  }

  type SearchResult {
    score: Float!
    product: Product!
  }

  type SchemaProposal {
    id: String!
    entity: String!
    ownerSubgraph: String!
    missingFields: [ProposalField!]!
    sdl: String!
    resolverStub: String!
    createdAt: String!
    status: String!
    prUrl: String
    prBranch: String
  }

  type ProposalField {
    name: String!
    type: String!
    nullable: Boolean!
    reason: String!
  }

  # ── Query Intelligence types ───────────────────────────────────────────────

  type QueryExplanation {
    query: String!
    plainEnglish: String!
    subgraphsInvolved: [String!]!
    estimatedComplexity: String!
    fieldCount: Int!
    operationType: String!
  }

  type CostAnalysis {
    query: String!
    estimatedCost: Int!
    depth: Int!
    fieldCount: Int!
    federationJumps: Int!
    riskLevel: String!
    recommendations: [String!]!
  }

  # ── PII / Compliance types ─────────────────────────────────────────────────

  type PIIReport {
    scannedAt: String!
    totalFieldsScanned: Int!
    piiFields: [PIIField!]!
    riskLevel: String!
    summary: String!
  }

  type PIIField {
    subgraph: String!
    typeName: String!
    fieldName: String!
    piiCategory: String!
    riskLevel: String!
    recommendation: String!
  }

  # ── Schema Consistency types ───────────────────────────────────────────────

  type ConsistencyReport {
    scannedAt: String!
    totalSubgraphsScanned: Int!
    inconsistencies: [SemanticInconsistency!]!
    summary: String!
  }

  type SemanticInconsistency {
    concept: String!
    occurrences: [FieldOccurrence!]!
    recommendation: String!
  }

  type FieldOccurrence {
    subgraph: String!
    typeName: String!
    fieldName: String!
  }

  # ── Deprecation types ──────────────────────────────────────────────────────

  type DeprecationCandidate {
    subgraph: String!
    typeName: String!
    fieldName: String!
    reason: String!
    usageCount: Int!
    lastSeenAt: String
    suggestedReplacement: String
  }

  # ── Caching types ──────────────────────────────────────────────────────────

  type CacheRecommendation {
    subgraph: String!
    typeName: String!
    fieldName: String!
    recommendedTTL: Int!
    rationale: String!
    httpCacheHeader: String!
  }

  # ── Anomaly Detection types ────────────────────────────────────────────────

  type AnomalyReport {
    generatedAt: String!
    totalRequests: Int!
    anomalies: [QueryAnomaly!]!
    summary: String!
  }

  type QueryAnomaly {
    severity: String!
    pattern: String!
    description: String!
    detectedAt: String!
  }

  # ── Resolver Health types ──────────────────────────────────────────────────

  type ResolverHealthReport {
    generatedAt: String!
    totalTrackedFields: Int!
    healthyCount: Int!
    degradedCount: Int!
    criticalCount: Int!
    fields: [FieldHealth!]!
    summary: String!
  }

  type FieldHealth {
    subgraph: String!
    field: String!
    status: String!
    errorCount: Int!
    lastError: String
    lastErrorAt: String
    suggestedFix: String
  }

  # ── PR Review types ────────────────────────────────────────────────────────

  type PRReviewResult {
    prNumber: Int!
    approved: Boolean!
    score: Int!
    verdict: String!
    comments: [ReviewComment!]!
    postedToGitHub: Boolean!
  }

  type ReviewComment {
    severity: String!
    rule: String!
    message: String!
    file: String
  }

  # ── Resolver Generator types ───────────────────────────────────────────────

  type GeneratedResolvers {
    proposalId: String!
    entity: String!
    resolverCode: String!
    mockDataExamples: String!
    integrationGuide: String!
  }

  extend type Product @key(fields: "id") {
    id: ID! @external
  }
`;

const resolvers = {
  Query: {
    // ── Core aiSearch ──────────────────────────────────────────────────────
    aiSearch: async (_: unknown, { prompt }: { prompt: string }) => {
      // Feed the anomaly detector before doing anything else
      trackRequest(prompt, []);

      // 1. Ground truth: all Product fields from the composed gateway schema
      const existingFields = await getProductFields(GATEWAY_URL);

      // 2. LLM interprets the prompt → intent + filters + requested fields
      const plan = await generatePlan(prompt, existingFields);
      console.log('[aiSearch] Claude plan:', JSON.stringify(plan, null, 2));
      console.log('[aiSearch] Existing fields:', existingFields);

      // Update anomaly detector with actual fields requested
      trackRequest(prompt, plan.fields);

      // 3. Delta detection — catch fields the AI invented that don't exist yet
      const missingFields = detectMissingFields(plan.fields, existingFields);
      console.log('[aiSearch] Missing fields:', missingFields);

      let pendingProposal = null;

      if (missingFields.length > 0) {
        const proposal = proposeProductSchemaDelta(
          missingFields,
          `Requested via aiSearch prompt: "${prompt}"`,
        );
        pendingProposal = upsertProposal(proposal);
        console.log(
          `[aiSearch] Schema delta queued → proposal ${pendingProposal.id}`,
        );

        // Auto-create a GitHub PR if this is a new proposal with no PR yet.
        // PR creation is async — prUrl will be null in THIS response but
        // populated in pendingSchemaProposals once GitHub responds (~1-2s).
        if (!pendingProposal.prUrl) {
          console.log(`[aiSearch] Firing PR creation for ${pendingProposal.id} (async)…`);
          createSchemaDeltaPR(pendingProposal)
            .then(({ prUrl, branch }) => {
              markPrCreated(pendingProposal!.id, prUrl, branch);
              console.log(`[aiSearch] ✅ PR created: ${prUrl}`);
              console.log(`[aiSearch] Query { pendingSchemaProposals { prUrl } } to see it.`);
            })
            .catch((err: Error) =>
              console.error(
                '[aiSearch] PR creation failed (add GITHUB_TOKEN to .env):',
                err.message,
              ),
            );
        } else {
          console.log(`[aiSearch] PR already exists: ${pendingProposal.prUrl}`);
        }

        // Trim plan to only fields that already exist so the query can proceed
        plan.fields = plan.fields.filter((f) => existingFields.includes(f));
      }

      // 4. Anti-hallucination validation
      validatePlan(plan, existingFields);

      // 5. Build and execute query
      const query = buildProductsQuery(plan.filters);
      const variables = buildVariables(plan.filters);
      const result = await executeQuery(GATEWAY_URL, query, variables);

      if (result.errors?.length) {
        throw new Error(`Gateway error: ${JSON.stringify(result.errors)}`);
      }

      const matchedProducts = result.data?.products ?? [];

      return {
        results: matchedProducts.map((p) => ({
          score: parseFloat((Math.random() * 0.15 + 0.85).toFixed(4)),
          product: { __typename: 'Product', id: p.id },
        })),
        pendingProposal,
      };
    },

    pendingSchemaProposals: () => loadProposals(),

    // ── Query Intelligence ─────────────────────────────────────────────────
    explainQuery: (_: unknown, { query }: { query: string }) =>
      explainQuery(query),

    analyzeQueryCost: (_: unknown, { query }: { query: string }) =>
      analyzeQueryCost(query),

    // ── Compliance ────────────────────────────────────────────────────────
    scanSchemaForPII: () => scanSchemaForPII(GATEWAY_URL),

    // ── Schema Governance ─────────────────────────────────────────────────
    checkSchemaConsistency: () => checkSchemaConsistency(),

    deprecationCandidates: () => getDeprecationCandidates(),

    cacheRecommendations: () => getCacheRecommendations(),

    // ── Observability ─────────────────────────────────────────────────────
    anomalyReport: () => getAnomalyReport(),

    resolverHealth: () => getResolverHealthReport(),
  },

  Mutation: {
    // ── Schema delta PR ───────────────────────────────────────────────────
    createSchemaDeltaPR: async (
      _: unknown,
      { proposalId }: { proposalId: string },
    ) => {
      const proposals = loadProposals();
      const proposal = proposals.find((p) => p.id === proposalId);

      if (!proposal) {
        throw new Error(`Proposal "${proposalId}" not found`);
      }

      if (proposal.prUrl) {
        console.log(
          `[mutation] PR already exists for ${proposalId}: ${proposal.prUrl}`,
        );
        return proposal;
      }

      const { prUrl, branch } = await createSchemaDeltaPR(proposal);
      return markPrCreated(proposalId, prUrl, branch);
    },

    // ── Resolver generator ────────────────────────────────────────────────
    generateFullResolvers: (
      _: unknown,
      { proposalId }: { proposalId: string },
    ) => {
      const proposals = loadProposals();
      const proposal = proposals.find((p) => p.id === proposalId);

      if (!proposal) {
        throw new Error(`Proposal "${proposalId}" not found`);
      }

      return generateFullResolvers(proposal);
    },

    // ── PR reviewer ───────────────────────────────────────────────────────
    reviewSchemaPR: (_: unknown, { prNumber }: { prNumber: number }) =>
      reviewSchemaPR(prNumber),

    // ── Observability mutations ───────────────────────────────────────────
    trackResolverError: (
      _: unknown,
      {
        subgraph,
        field,
        error,
      }: { subgraph: string; field: string; error: string },
    ) => {
      trackResolverError(subgraph, field, error);
      return true;
    },

    recordFieldAccess: (
      _: unknown,
      {
        subgraph,
        typeName,
        fieldName,
      }: { subgraph: string; typeName: string; fieldName: string },
    ) => {
      recordFieldAccess(subgraph, typeName, fieldName);
      return true;
    },
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4004 } }).then(({ url }) => {
  console.log(`\n🚀 Discovery subgraph ready at ${url}`);
  console.log('\n📡 Available AI features:');
  console.log('  Queries:');
  console.log('    aiSearch(prompt)            — AI-powered product search');
  console.log('    pendingSchemaProposals       — View queued schema proposals');
  console.log('    explainQuery(query)          — Plain-English query breakdown');
  console.log('    analyzeQueryCost(query)      — Cost & depth analysis');
  console.log('    scanSchemaForPII             — GDPR/CCPA PII field scanner');
  console.log('    checkSchemaConsistency       — Cross-subgraph naming audit');
  console.log('    deprecationCandidates        — Low-usage field candidates');
  console.log('    cacheRecommendations         — Per-field TTL advisor');
  console.log('    anomalyReport                — Query pattern anomaly detection');
  console.log('    resolverHealth               — Resolver error diagnostics');
  console.log('  Mutations:');
  console.log('    createSchemaDeltaPR          — Open GitHub PR for a proposal');
  console.log('    generateFullResolvers        — Generate mock resolver code');
  console.log('    reviewSchemaPR(prNumber)     — Post automated SDL review');
  console.log('    trackResolverError           — Record a resolver failure');
  console.log('    recordFieldAccess            — Record field usage for deprecation tracking');
});
