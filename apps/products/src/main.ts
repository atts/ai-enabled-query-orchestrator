import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

  input ProductFilter {
    keyword: String
    category: String
    priceMax: Float
  }

  type Query {
    products(filter: ProductFilter): [Product]
    product(id: ID!): Product
  }

  type Product @key(fields: "id") {
    id: ID!
    name: String
    description: String
    price: Float
    category: String
  }
`;

const products = [
  { id: '1', name: 'Laptop', description: 'High-end gaming laptop', price: 1500, category: 'Electronics' },
  { id: '2', name: 'Phone', description: 'Latest smartphone', price: 800, category: 'Electronics' },
  { id: '3', name: 'Desk Chair', description: 'Ergonomic office chair', price: 350, category: 'Furniture' },
  { id: '4', name: 'Wireless Headphones', description: 'Noise-cancelling over-ear headphones', price: 250, category: 'Electronics' },
];

const resolvers = {
  Query: {
    products: (_: unknown, { filter }: { filter?: { keyword?: string; category?: string; priceMax?: number } } = {}) => {
      let result = products;
      if (filter?.keyword) {
        const kw = filter.keyword.toLowerCase();
        result = result.filter(
          (p) => p.name.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw),
        );
      }
      if (filter?.category) {
        result = result.filter((p) => p.category.toLowerCase() === filter.category!.toLowerCase());
      }
      if (filter?.priceMax != null) {
        result = result.filter((p) => p.price <= filter.priceMax!);
      }
      return result;
    },
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
