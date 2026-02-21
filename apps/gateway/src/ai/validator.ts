import { AiSearchPlan } from './types';

export function validatePlan(plan: AiSearchPlan, allowedFields: string[]) {
  if (plan.intent !== 'SEARCH_PRODUCTS') {
    throw new Error('Unsupported intent');
  }

  for (const field of plan.fields) {
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field requested: ${field}`);
    }
  }
}
