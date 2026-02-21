import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

import { generatePlan } from './ai/planner';
import { validatePlan } from './ai/validator';
import { detectMissingFields } from './ai/delta/detector';
import { proposeProductSchemaDelta } from './ai/delta/proposer';
import { getProductFields } from './execution/schemaIntrospection';
import { buildProductsQuery, buildVariables } from './execution/queryBuilder';
import { executeQuery } from './execution/executor';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4000/graphql';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.0"
      import: ["@key", "@external"]
    )

  type Query {
    aiSearch(prompt: String!): [SearchResult!]!
  }

  type SearchResult {
    score: Float!
    product: Product!
  }

  extend type Product @key(fields: "id") {
    id: ID! @external
  }
`;

const resolvers = {
  Query: {
    aiSearch: async (_: unknown, { prompt }: { prompt: string }) => {
      // 1. Ground truth: all Product fields from the composed gateway schema
      const existingFields = await getProductFields(GATEWAY_URL);

      // 2. LLM interprets the prompt → intent + filters + requested fields
      const plan = await generatePlan(prompt, existingFields);
      console.log('[aiSearch] Claude plan:', JSON.stringify(plan, null, 2));
      console.log('[aiSearch] Existing fields:', existingFields);

      // 3. Delta detection — catch fields the AI invented that don't exist yet
      const missingFields = detectMissingFields(plan.fields, existingFields);
      console.log('[aiSearch] Missing fields:', missingFields);

      if (missingFields.length > 0) {
        const proposal = proposeProductSchemaDelta(
          missingFields,
          `Requested via aiSearch prompt: "${prompt}"`,
        );
        throw new Error(
          JSON.stringify({ type: 'SCHEMA_DELTA_REQUIRED', proposal }, null, 2),
        );
      }

      // 4. Anti-hallucination validation — all fields must exist in schema
      validatePlan(plan, existingFields);

      // 5. Build a deterministic GraphQL query to find matching product IDs
      const query = buildProductsQuery(plan.filters);
      const variables = buildVariables(plan.filters);

      // 6. Execute against the federation gateway
      const result = await executeQuery(GATEWAY_URL, query, variables);

      if (result.errors?.length) {
        throw new Error(`Gateway error: ${JSON.stringify(result.errors)}`);
      }

      const matchedProducts = result.data?.products ?? [];

      // 7. Return stubs — federation resolves full Product fields for
      //    whatever fields the client requests on SearchResult.product
      return matchedProducts.map((p) => ({
        score: parseFloat((Math.random() * 0.15 + 0.85).toFixed(4)),
        product: { __typename: 'Product', id: p.id },
      }));
    },
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4004 } }).then(({ url }) => {
  console.log(`🚀 Discovery subgraph ready at ${url}`);
});
