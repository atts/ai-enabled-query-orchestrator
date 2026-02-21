import { GraphQLSchema } from 'graphql';

export function getProductFields(schema: GraphQLSchema): string[] {
  const type = schema.getType('Product');
  if (!type || !('getFields' in type)) return [];
  return Object.keys(type.getFields());
}
