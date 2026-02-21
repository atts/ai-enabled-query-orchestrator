import { generatePlan } from '../../ai/planner';
import { validatePlan } from '../../ai/validator';

import { getProductFields } from '../../execution/schemaIntrospection';
import { buildQuery } from '../../execution/queryBuilder';
import { executeQuery } from '../../execution/executor';

import { detectMissingFields } from '../../ai/delta/detector';
import { proposeProductSchemaDelta } from '../../ai/delta/proposer';

export const Query = {
  aiSearch: async (_: any, { prompt }: { prompt: string }, ctx: any) => {
    // 1. Ground truth: live Product fields from composed schema
    const existingFields = getProductFields(ctx.schema);

    // 2. LLM generates intent + requested fields
    const plan = await generatePlan(prompt, existingFields);

    // 3. STEP 8 — detect missing schema
    const missingFields = detectMissingFields(plan.fields, existingFields);

    if (missingFields.length > 0) {
      const proposal = proposeProductSchemaDelta(
        missingFields,
        `Requested via aiSearch prompt: "${prompt}"`,
      );

      // Stop execution intentionally
      throw new Error(
        JSON.stringify(
          {
            type: 'SCHEMA_DELTA_REQUIRED',
            proposal,
          },
          null,
          2,
        ),
      );
    }

    // 4. STEP 7 — strict validation (anti-hallucination)
    validatePlan(plan, existingFields);

    // 5. Deterministic GraphQL query construction
    const query = buildQuery(plan.fields);

    // 6. Execute via gateway (federation-aware)
    const result = await executeQuery(ctx, query, {
      keyword: plan.filters?.keyword,
    });

    // 7. Map results to public API shape
    return result.data.products.map((product: any) => ({
      score: Math.random() * 0.15 + 0.85,
      product,
    }));
  },
};
