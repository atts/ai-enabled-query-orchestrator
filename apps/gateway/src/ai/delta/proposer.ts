import { SchemaDeltaProposal } from './types';

export function proposeProductSchemaDelta(
  missingFields: string[],
  reason: string,
): SchemaDeltaProposal {
  return {
    entity: 'Product',
    ownerSubgraph: 'product',

    missingFields: missingFields.map((field) => ({
      name: field,
      type: 'String',
      nullable: true,
      reason,
    })),

    sdl: `
extend type Product {
${missingFields.map((f) => `  ${f}: String`).join('\n')}
}
`.trim(),

    resolverStub: `
export const Product = {
${missingFields
  .map(
    (f) => `  ${f}: async (parent) => {
    // TODO: implement ${f}
    return null;
  }`,
  )
  .join(',\n')}
};
`.trim(),
  };
}
