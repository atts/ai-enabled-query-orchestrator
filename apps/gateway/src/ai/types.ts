// apps/gateway/src/ai/types.ts
export type AiSearchPlan = {
  intent: 'SEARCH_PRODUCTS';
  filters?: {
    keyword?: string;
    category?: string;
    priceMax?: number;
    inStock?: boolean;
  };
  fields: string[];
};
