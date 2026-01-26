import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external"])

  type Product @key(fields: "id") {
    id: ID! @external
    inStock: Boolean
  }
`;

const inventory = [
  { id: '1', inStock: true },
  { id: '2', inStock: false }
];

const resolvers = {
  Product: {
    inStock: (product) => inventory.find(i => i.id === product.id)?.inStock,
  }
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4002 } }).then(({ url }) => {
  console.log(`🚀 Inventory subgraph ready at ${url}`);
});