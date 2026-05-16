import { AiSearchPlan } from './types';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { callLLM } from './llmClient';

// ─── Mock scenarios (MOCK_LLM=true) ────────────────────────────────────────
// Each scenario is triggered by keywords in the prompt so you can accumulate
// multiple different proposals in schema-proposals.json during demos.

const MOCK_SCENARIOS: {
  keywords: string[];
  plan: AiSearchPlan;
}[] = [
  {
    // Prompt contains: eco, sustain, green, carbon, environment
    keywords: ['eco', 'sustain', 'green', 'carbon', 'environment'],
    plan: {
      intent: 'SEARCH_PRODUCTS',
      filters: { category: 'electronics' },
      fields: [
        'id', 'name', 'price', 'category',
        'sustainabilityScore', 'carbonFootprintKg',
        'energyEfficiencyRating', 'recycledMaterialsPct',
      ],
    },
  },
  {
    // Prompt contains: spec, ram, cpu, battery, benchmark, performance, tech
    keywords: ['spec', 'ram', 'cpu', 'battery', 'benchmark', 'performance', 'tech'],
    plan: {
      intent: 'SEARCH_PRODUCTS',
      filters: { category: 'electronics' },
      fields: [
        'id', 'name', 'price', 'category',
        'ramGb', 'storageGb', 'batteryLifeHours',
        'benchmarkScore', 'processorModel',
      ],
    },
  },
  {
    // Prompt contains: fashion, cloth, style, size, color, fabric, wear
    keywords: ['fashion', 'cloth', 'style', 'size', 'color', 'fabric', 'wear'],
    plan: {
      intent: 'SEARCH_PRODUCTS',
      filters: { category: 'clothing' },
      fields: [
        'id', 'name', 'price', 'category',
        'availableSizes', 'colorOptions', 'fabricMaterial',
        'fitType', 'styleTag',
      ],
    },
  },
  {
    // Prompt contains: rating, review, score, trusted, expert, popular
    keywords: ['rating', 'review', 'score', 'trusted', 'expert', 'popular'],
    plan: {
      intent: 'SEARCH_PRODUCTS',
      filters: {},
      fields: [
        'id', 'name', 'price', 'category',
        'rating', 'reviewCount', 'verifiedReviewsPct',
        'expertScore', 'awardBadge',
      ],
    },
  },
  {
    // Prompt contains: health, nutrition, organic, calorie, allergen, diet
    keywords: ['health', 'nutrition', 'organic', 'calorie', 'allergen', 'diet'],
    plan: {
      intent: 'SEARCH_PRODUCTS',
      filters: { category: 'food' },
      fields: [
        'id', 'name', 'price', 'category',
        'caloriesPer100g', 'nutritionScore', 'allergenInfo',
        'organicCertified', 'glutenFree',
      ],
    },
  },
];

// Fallback plan when no keywords match
const DEFAULT_MOCK_PLAN: AiSearchPlan = {
  intent: 'SEARCH_PRODUCTS',
  filters: {},
  fields: ['id', 'name', 'price', 'category'],
};

function pickMockPlan(prompt: string): AiSearchPlan {
  const lower = prompt.toLowerCase();
  const match = MOCK_SCENARIOS.find((s) =>
    s.keywords.some((kw) => lower.includes(kw)),
  );
  return match ? match.plan : DEFAULT_MOCK_PLAN;
}
// ────────────────────────────────────────────────────────────────────────────

export async function generatePlan(
  prompt: string,
  fields: string[],
): Promise<AiSearchPlan> {
  if (process.env.MOCK_LLM === 'true') {
    const plan = pickMockPlan(prompt);
    console.log('[generatePlan] MOCK_LLM=true — scenario matched for prompt:', prompt);
    return plan;
  }

  const raw = await callLLM(SYSTEM_PROMPT, userPrompt(prompt, fields));

  // Strip markdown code fences if LLM wraps its response
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  return JSON.parse(cleaned);
}
