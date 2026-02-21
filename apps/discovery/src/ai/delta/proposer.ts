import { SchemaDeltaProposal } from './types';

export function proposeProductSchemaDelta(
  missingFields: string[],
  reason: string,
): SchemaDeltaProposal {
  return {
    entity: 'Product',
    ownerSubgraph: 'products',

    missingFields: missingFields.map((field) => ({
      name: field,
      type: 'String',
      nullable: true,
      reason,
    })),

    sdl: `extend type Product {\n${missingFields.map((f) => `  ${f}: String`).join('\n')}\n}`,

    resolverStub: `export const Product = {\n${missingFields
      .map(
        (f) =>
          `  ${f}: async (parent) => {\n    // TODO: implement ${f}\n    return null;\n  }`,
      )
      .join(',\n')}\n};`,
  };
}
