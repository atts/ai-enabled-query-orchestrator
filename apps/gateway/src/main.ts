import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { ApolloGateway, IntrospectAndCompose } from '@apollo/gateway';

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: 'products', url: 'http://localhost:4001/graphql' },
      { name: 'inventory', url: 'http://localhost:4002/graphql' },
      { name: 'cart', url: 'http://localhost:4003/graphql' },
      { name: 'discovery', url: 'http://localhost:4004/graphql' },
    ],
    // Retry composing every 5 s so gateway and subgraphs can start in parallel
    pollIntervalInMs: 5000,
  }),
});

const server = new ApolloServer({ gateway });

startStandaloneServer(server, { listen: { port: 4000 } }).then(({ url }) => {
  console.log(`🚀 Gateway ready at ${url}`);
});
