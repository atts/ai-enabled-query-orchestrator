// Cross-Subgraph Semantic Consistency Checker
// Detects when the same business concept appears under different field names
// across subgraphs — a common drift problem in federated architectures.

const SUBGRAPH_URLS: Record<string, string> = {
  products: 'http://localhost:4001/graphql',
  inventory: 'http://localhost:4002/graphql',
  cart: 'http://localhost:4003/graphql',
  discovery: 'http://localhost:4004/graphql',
};

const INTROSPECT_ALL = `
  {
    __schema {
      types {
        name
        kind
        fields { name }
      }
    }
  }
`;

// Synonym groups: canonical name → known aliases
// If fields from different subgraphs map to the same canonical concept, flag them.
const SYNONYM_GROUPS: { concept: string; aliases: RegExp[]; recommendation: string }[] = [
  {
    concept: 'price',
    aliases: [/\bprice\b/i, /\bcost\b/i, /unitCost/i, /\bamount\b/i, /\bvalue\b/i, /\brate\b/i],
    recommendation: 'Standardize to "price" (Float) across all subgraphs for consistent client queries.',
  },
  {
    concept: 'quantity / stock count',
    aliases: [/\bquantity\b/i, /\bstock\b/i, /\bcount\b/i, /\bunits\b/i, /\bavailable\b/i, /stockLevel/i],
    recommendation: 'Standardize to "quantity" (Int) in the inventory subgraph and expose via federation.',
  },
  {
    concept: 'product identifier',
    aliases: [/\bproductId\b/i, /\bitemId\b/i, /\bsku\b/i, /\bproduct\b/i],
    recommendation: 'Use federation @key(fields: "id") consistently. Avoid duplicating product references.',
  },
  {
    concept: 'user / customer identifier',
    aliases: [/\buserId\b/i, /\bcustomerId\b/i, /\baccountId\b/i, /\bownerId\b/i],
    recommendation: 'Standardize to "userId" and own it in a dedicated user/auth subgraph.',
  },
  {
    concept: 'creation timestamp',
    aliases: [/createdAt/i, /createDate/i, /dateCreated/i, /\bcreated\b/i, /insertedAt/i],
    recommendation: 'Standardize to "createdAt" (String ISO-8601) across all subgraphs.',
  },
  {
    concept: 'update timestamp',
    aliases: [/updatedAt/i, /updateDate/i, /dateModified/i, /lastModified/i, /modifiedAt/i],
    recommendation: 'Standardize to "updatedAt" (String ISO-8601) across all subgraphs.',
  },
  {
    concept: 'display name',
    aliases: [/\bname\b/i, /\btitle\b/i, /\blabel\b/i, /displayName/i],
    recommendation: 'Use "name" for products/categories, "title" only for content-oriented types.',
  },
  {
    concept: 'description / summary',
    aliases: [/\bdescription\b/i, /\bsummary\b/i, /\bdetails\b/i, /\boverview\b/i, /\binfo\b/i],
    recommendation: 'Standardize to "description" (String) for product-type entities.',
  },
  {
    concept: 'active / enabled status',
    aliases: [/\bactive\b/i, /\benabled\b/i, /isActive/i, /isEnabled/i, /\bstatus\b/i, /\bvisible\b/i],
    recommendation: 'Standardize to "isActive" (Boolean) for binary status, "status" (enum) for multi-state.',
  },
  {
    concept: 'image / thumbnail',
    aliases: [/imageUrl/i, /\bimage\b/i, /thumbnail/i, /\bphoto\b/i, /\bavatar\b/i, /\bicon\b/i],
    recommendation: 'Standardize to "imageUrl" (String) for primary image references.',
  },
];

export type FieldOccurrence = {
  subgraph: string;
  typeName: string;
  fieldName: string;
};

export type SemanticInconsistency = {
  concept: string;
  occurrences: FieldOccurrence[];
  recommendation: string;
};

export type ConsistencyReport = {
  scannedAt: string;
  subgraphsScanned: string[];
  totalFieldsAnalyzed: number;
  inconsistencies: SemanticInconsistency[];
  summary: string;
};

async function getSubgraphFields(
  subgraph: string,
  url: string,
): Promise<{ subgraph: string; typeName: string; fieldName: string }[]> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECT_ALL }),
    });
    const json = (await res.json()) as {
      data?: { __schema?: { types: { name: string; kind: string; fields: { name: string }[] | null }[] } };
    };
    const types = (json.data?.__schema?.types ?? []).filter(
      (t) => t.kind === 'OBJECT' && !t.name.startsWith('__') && t.fields,
    );
    return types.flatMap((t) =>
      (t.fields ?? []).map((f) => ({ subgraph, typeName: t.name, fieldName: f.name })),
    );
  } catch {
    return [];
  }
}

export async function checkSchemaConsistency(): Promise<ConsistencyReport> {
  const scannedAt = new Date().toISOString();
  const subgraphsScanned: string[] = [];
  let allFields: { subgraph: string; typeName: string; fieldName: string }[] = [];

  for (const [subgraph, url] of Object.entries(SUBGRAPH_URLS)) {
    const fields = await getSubgraphFields(subgraph, url);
    if (fields.length > 0) {
      subgraphsScanned.push(subgraph);
      allFields = allFields.concat(fields);
    }
  }

  const inconsistencies: SemanticInconsistency[] = [];

  for (const group of SYNONYM_GROUPS) {
    // Find all field occurrences that match any alias in this group
    const matches = allFields.filter((f) =>
      group.aliases.some((alias) => alias.test(f.fieldName)),
    );

    if (matches.length === 0) continue;

    // Group by which alias they matched — inconsistency exists when >1 distinct alias matches
    const distinctAliases = new Set(
      matches.map((m) => {
        const matchedAlias = group.aliases.find((a) => a.test(m.fieldName));
        return matchedAlias?.source ?? m.fieldName;
      }),
    );

    // Also flag if the same concept appears in multiple subgraphs with different names
    const distinctFieldNames = new Set(matches.map((m) => m.fieldName));
    const distinctSubgraphs = new Set(matches.map((m) => m.subgraph));

    if (distinctAliases.size > 1 && (distinctSubgraphs.size > 1 || distinctFieldNames.size > 1)) {
      inconsistencies.push({
        concept: group.concept,
        occurrences: matches,
        recommendation: group.recommendation,
      });
    }
  }

  const summary =
    inconsistencies.length === 0
      ? `All ${subgraphsScanned.length} subgraphs scanned. No semantic inconsistencies found.`
      : `Found ${inconsistencies.length} semantic inconsistency(ies) across ${subgraphsScanned.length} subgraph(s). Standardizing field names will improve client developer experience and reduce federation complexity.`;

  return {
    scannedAt,
    subgraphsScanned,
    totalFieldsAnalyzed: allFields.length,
    inconsistencies,
    summary,
  };
}
