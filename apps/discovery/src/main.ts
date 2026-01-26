import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.0"
      import: ["@key", "@external"]
    ) # <--- Make sure @external is imported!
  type Query {
    aiSearch(prompt: String!): [SearchResult]
  }

  type SearchResult {
    score: Float
    product: Product
  }

  # This is the most common failure point
  extend type Product @key(fields: "id") {
    id: ID! @external
  }
`;

const resolvers = {
  Query: {
    aiSearch: (_, { prompt }) => {
      // Temporary mock data
      return [{ score: 0.95, product: { __typename: 'Product', id: '1' } }];
    },
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4004 } }).then(({ url }) => {
  console.log(`🚀 Discovery Subgraph ready at ${url}`);
});
