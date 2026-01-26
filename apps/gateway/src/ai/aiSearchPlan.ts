export type AiSearchPlan = {
  intent: 'SEARCH_PRODUCTS';
  filters?: {
    keyword?: string;
  };
  fields: string[];
};
