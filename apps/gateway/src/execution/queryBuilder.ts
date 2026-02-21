export function buildQuery(fields: string[]) {
  return `
    query AiSearch($keyword: String) {
      products(filter: { keyword: $keyword }) {
        ${fields.join('\n')}
      }
    }
  `;
}
