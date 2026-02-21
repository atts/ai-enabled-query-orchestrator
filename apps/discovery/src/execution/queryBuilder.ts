import { AiSearchPlan } from '../ai/types';

export function buildProductsQuery(
  filters: AiSearchPlan['filters'],
): string {
  const varDecls: string[] = [];
  const filterParts: string[] = [];

  if (filters?.keyword) {
    varDecls.push('$keyword: String');
    filterParts.push('keyword: $keyword');
  }
  if (filters?.category) {
    varDecls.push('$category: String');
    filterParts.push('category: $category');
  }
  if (filters?.priceMax != null) {
    varDecls.push('$priceMax: Float');
    filterParts.push('priceMax: $priceMax');
  }

  const varStr = varDecls.length > 0 ? `(${varDecls.join(', ')})` : '';
  const filterStr =
    filterParts.length > 0 ? `(filter: { ${filterParts.join(', ')} })` : '';

  // Fetch only id here — federation resolves the rest when the client
  // requests specific fields on SearchResult.product
  return `
    query AiSearch${varStr} {
      products${filterStr} {
        id
      }
    }
  `;
}

export function buildVariables(
  filters: AiSearchPlan['filters'],
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  if (filters?.keyword) vars.keyword = filters.keyword;
  if (filters?.category) vars.category = filters.category;
  if (filters?.priceMax != null) vars.priceMax = filters.priceMax;
  return vars;
}
