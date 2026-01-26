import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.0"
      import: ["@key", "@external"]
    ) # <--- Check this line!
  type Query {
    cart(id: ID!): Cart
  }

  type Cart @key(fields: "id") {
    id: ID!
    items: [CartItem]
  }

  type CartItem {
    productId: ID!
    quantity: Int
    product: Product
  }

  # We extend Product to link the CartItem to the Product Subgraph
  extend type Product @key(fields: "id") {
    id: ID! @external
  }
`;

const carts = [{ id: 'c1', items: [{ productId: '1', quantity: 1 }] }];

const resolvers = {
  Query: {
    cart: (_, { id }) => carts.find((c) => c.id === id),
  },
  CartItem: {
    product: (item) => ({ __typename: 'Product', id: item.productId }),
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema({ typeDefs, resolvers }),
});

startStandaloneServer(server, { listen: { port: 4003 } }).then(({ url }) => {
  console.log(`🚀 Cart subgraph ready at ${url}`);
});
