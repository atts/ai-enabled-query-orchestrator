import { AiSearchPlan } from './types';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { callLLM } from './llmClient';

// Mock plan used when MOCK_LLM=true — simulates Claude inferring fields that
// don't exist yet, triggering the SCHEMA_DELTA_REQUIRED flow end-to-end.
const MOCK_PLAN: AiSearchPlan = {
  intent: 'SEARCH_PRODUCTS',
  filters: { category: 'electronics' },
  fields: [
    'id',
    'name',
    'price',
    'category',
    'sustainabilityScore',
    'carbonFootprintKg',
    'energyEfficiencyRating',
    'recycledMaterialsPct',
  ],
};

export async function generatePlan(
  prompt: string,
  fields: string[],
): Promise<AiSearchPlan> {
  if (process.env.MOCK_LLM === 'true') {
    console.log('[generatePlan] MOCK_LLM=true — returning hardcoded plan');
    return MOCK_PLAN;
  }

  const raw = await callLLM(SYSTEM_PROMPT, userPrompt(prompt, fields));

  // Strip markdown code fences if LLM wraps its response
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  return JSON.parse(cleaned);
}
