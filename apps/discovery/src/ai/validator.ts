import { AiSearchPlan } from './types';

export function validatePlan(plan: AiSearchPlan, allowedFields: string[]) {
  if (plan.intent !== 'SEARCH_PRODUCTS') {
    throw new Error(`Unsupported intent: ${plan.intent}`);
  }

  const invalid = plan.fields.filter((f) => !allowedFields.includes(f));
  if (invalid.length > 0) {
    throw new Error(`Fields not in schema: ${invalid.join(', ')}`);
  }
}
