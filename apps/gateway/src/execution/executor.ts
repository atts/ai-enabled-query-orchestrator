export async function executeQuery(ctx: any, query: string, variables: any) {
  return ctx.executeGraphQL({ query, variables });
}
