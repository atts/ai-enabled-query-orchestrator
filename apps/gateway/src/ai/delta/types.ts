export type SchemaDeltaProposal = {
  entity: 'Product';
  ownerSubgraph: string;

  missingFields: {
    name: string;
    type: string;
    nullable: boolean;
    reason: string;
  }[];

  sdl: string;
  resolverStub: string;
};
