import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

  type Query {
    products: [Product]
    product(id: ID!): Product
  }

  type Product @key(fields: "id") {
    id: ID!
    name: String
    description: String
    price: Float
  }
`;

const products = [
  {
    id: '1',
    name: 'Laptop',
    description: 'High-end gaming laptop',
    price: 1500,
  },
  { id: '2', name: 'Phone', description: 'Latest smartphone', price: 800 },
];

const resolvers = {
  Query: {
    products: () => products,
    product: (_, { id }) => products.find((p) => p.id === id),
  },
  Product: {
    __resolveReference(reference) {
      return products.find((p) => p.id === reference.id);
    },
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4001 } }).then(({ url }) => {
  console.log(`🚀 Products subgraph ready at ${url}`);
});
