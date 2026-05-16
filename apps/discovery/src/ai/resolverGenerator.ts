// Full Resolver Generator
// Generates working TypeScript resolver code with realistic mock data
// based on field name patterns. Replaces stub-only generation with
// implementations that return sensible values for immediate testing.

import { StoredProposal } from '../ai/delta/store';

export type GeneratedResolvers = {
  proposalId: string;
  entity: string;
  resolverCode: string;
  mockDataExamples: string;
  integrationGuide: string;
};

// ─── Mock value generators by field name pattern ──────────────────────────────

type FieldPattern = {
  pattern: RegExp;
  tsType: string;
  mockValue: (fieldName: string) => string;
  dataSourceHint: string;
};

const FIELD_PATTERNS: FieldPattern[] = [
  // Numeric scores / ratings / percentages
  {
    pattern: /score|rating|rank|grade|quality/i,
    tsType: 'number',
    mockValue: () => 'parseFloat((Math.random() * 5 + 1).toFixed(1))', // 1.0 – 6.0 scale
    dataSourceHint: 'Compute from aggregated user ratings or ML scoring model',
  },
  {
    pattern: /pct|percent|ratio|rate$/i,
    tsType: 'number',
    mockValue: () => 'parseFloat((Math.random() * 100).toFixed(1))',
    dataSourceHint: 'Calculate from raw counts (e.g., positiveReviews / totalReviews * 100)',
  },
  // Size / weight / measurement units
  {
    pattern: /\bGb\b|ramGb|storageGb|diskGb/i,
    tsType: 'number',
    mockValue: () => '[4, 8, 16, 32, 64][Math.floor(Math.random() * 5)]',
    dataSourceHint: 'Read from product specifications table (column: ram_gb or storage_gb)',
  },
  {
    pattern: /Kg|weightKg|massKg/i,
    tsType: 'number',
    mockValue: () => 'parseFloat((Math.random() * 10 + 0.1).toFixed(2))',
    dataSourceHint: 'Read from product specifications table (column: weight_kg)',
  },
  {
    pattern: /hours|Hours|lifetime/i,
    tsType: 'number',
    mockValue: () => 'Math.floor(Math.random() * 24 + 1)',
    dataSourceHint: 'Read from product specifications (column: battery_life_hours or lifetime_hours)',
  },
  {
    pattern: /count|Count|total|Total|num[A-Z]/i,
    tsType: 'number',
    mockValue: () => 'Math.floor(Math.random() * 500)',
    dataSourceHint: 'Count query on related table (e.g., SELECT COUNT(*) FROM reviews WHERE product_id = $id)',
  },
  // Boolean flags
  {
    pattern: /^is[A-Z]|^has[A-Z]|Certified$|Free$|Enabled$|Verified$/i,
    tsType: 'boolean',
    mockValue: () => 'Math.random() > 0.5',
    dataSourceHint: 'Read from product flags table (boolean column)',
  },
  // Timestamps
  {
    pattern: /At$|Date$|Time$/i,
    tsType: 'string',
    mockValue: () => 'new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()',
    dataSourceHint: 'Read from database timestamp column (ensure UTC storage)',
  },
  // URLs / images
  {
    pattern: /Url$|Image$|Photo$|Thumbnail$/i,
    tsType: 'string',
    mockValue: (f) => `\`https://cdn.example.com/products/\${parent.id}/${f}.jpg\``,
    dataSourceHint: 'Construct from CDN base URL + product ID + asset type',
  },
  // Color/size arrays
  {
    pattern: /colors|Colors|sizes|Sizes|options|Options/i,
    tsType: 'string[]',
    mockValue: (f) =>
      f.toLowerCase().includes('color')
        ? "['Black', 'White', 'Silver'][Math.floor(Math.random() * 3)]"
        : "['S', 'M', 'L', 'XL'][Math.floor(Math.random() * 4)]",
    dataSourceHint: 'Read from product_variants table or JSON column',
  },
  // Allergen / health info
  {
    pattern: /allergen|Allergen/i,
    tsType: 'string',
    mockValue: () => "['None', 'Contains nuts', 'Contains gluten', 'Dairy-free'][Math.floor(Math.random() * 4)]",
    dataSourceHint: 'Read from product_nutrition or product_allergens table',
  },
  {
    pattern: /calorie|nutrition|macro/i,
    tsType: 'number',
    mockValue: () => 'Math.floor(Math.random() * 500 + 50)',
    dataSourceHint: 'Read from product_nutrition table (column: calories_per_100g)',
  },
  // Energy/efficiency ratings
  {
    pattern: /efficiency|Efficiency|energyRating/i,
    tsType: 'string',
    mockValue: () => "['A+++', 'A++', 'A+', 'A', 'B'][Math.floor(Math.random() * 5)]",
    dataSourceHint: 'Read from product_specifications (column: energy_efficiency_rating)',
  },
  // Processor / tech specs
  {
    pattern: /processor|Processor|cpu|Cpu|chip/i,
    tsType: 'string',
    mockValue: () => "['Intel i7-12700K', 'Apple M3 Pro', 'AMD Ryzen 9 7900X'][Math.floor(Math.random() * 3)]",
    dataSourceHint: 'Read from product_specifications (column: processor_model)',
  },
  // Carbon / sustainability
  {
    pattern: /carbon|Carbon|co2|emission/i,
    tsType: 'number',
    mockValue: () => 'parseFloat((Math.random() * 50 + 0.5).toFixed(2))',
    dataSourceHint: 'Read from product_sustainability table (requires LCA data from supplier)',
  },
  {
    pattern: /recycled|Recycled|sustainable|eco/i,
    tsType: 'number',
    mockValue: () => 'parseFloat((Math.random() * 100).toFixed(1))',
    dataSourceHint: 'Read from product_sustainability (column: recycled_materials_pct)',
  },
  // Award / badge
  {
    pattern: /award|Award|badge|Badge|certification/i,
    tsType: 'string',
    mockValue: () => "['Energy Star', 'Best Buy 2024', null][Math.floor(Math.random() * 3)]",
    dataSourceHint: 'Read from product_awards table (may be null for many products)',
  },
];

const DEFAULT_PATTERN: FieldPattern = {
  pattern: /.*/,
  tsType: 'string',
  mockValue: (f) => `\`Mock ${f.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} for product \${parent.id}\``,
  dataSourceHint: 'Add to the appropriate database table and read via the product resolver',
};

function getPattern(fieldName: string): FieldPattern {
  return FIELD_PATTERNS.find((p) => p.pattern.test(fieldName)) ?? DEFAULT_PATTERN;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function generateFullResolvers(proposal: StoredProposal): GeneratedResolvers {
  const fields = proposal.missingFields;

  // Build resolver code
  const resolverLines = fields.map((f) => {
    const pattern = getPattern(f.name);
    return `  /**
   * ${f.name} — ${f.reason}
   * Data source hint: ${pattern.dataSourceHint}
   * Replace the mock below with a real data fetch.
   */
  ${f.name}: async (parent: { id: string }): Promise<${pattern.tsType} | null> => {
    // TODO: Replace with: return await db.products.findOne(parent.id).select('${f.name}');
    return ${pattern.mockValue(f.name)};
  },`;
  });

  const resolverCode = `import type { ${proposal.entity} } from './types'; // adjust import to your type location

// Auto-generated by AI Discovery Service — Proposal ${proposal.id}
// Created: ${new Date().toISOString()}
//
// Integration steps:
//   1. Add the SDL fields below to the ${proposal.entity} type in apps/${proposal.ownerSubgraph}/src/main.ts
//   2. Merge this resolver object into the existing ${proposal.entity} resolver
//   3. Replace each mock return value with real data-fetching logic
//   4. Restart the ${proposal.ownerSubgraph} subgraph — fields will be live immediately

export const ${proposal.entity}Extensions = {
${resolverLines.join('\n\n')}
};`;

  // Build mock data examples for documentation
  const mockExamples: Record<string, unknown> = {};
  for (const f of fields) {
    const pattern = getPattern(f.name);
    // Evaluate mock value safely for documentation purposes
    try {
      const mockFn = new Function('parent', 'Math', `return ${pattern.mockValue(f.name)}`);
      mockExamples[f.name] = mockFn({ id: 'example-id' }, Math);
    } catch {
      mockExamples[f.name] = `<${pattern.tsType}>`;
    }
  }

  const integrationGuide = `## Integration Guide for Proposal ${proposal.id}

### 1. Add SDL to \`apps/${proposal.ownerSubgraph}/src/main.ts\`

\`\`\`graphql
${proposal.sdl}
\`\`\`

### 2. Add resolvers to the ${proposal.entity} resolver object

\`\`\`typescript
// Merge ${proposal.entity}Extensions into your existing ${proposal.entity} resolver:
${proposal.entity}: {
  __resolveReference(reference) { /* existing */ },
  ...${proposal.entity}Extensions,
}
\`\`\`

### 3. Data source hints per field

${fields.map((f) => {
  const pattern = getPattern(f.name);
  return `- **\`${f.name}\`** (${pattern.tsType}): ${pattern.dataSourceHint}`;
}).join('\n')}

### 4. Expected mock responses

\`\`\`json
${JSON.stringify(mockExamples, null, 2)}
\`\`\`
`;

  return {
    proposalId: proposal.id,
    entity: proposal.entity,
    resolverCode,
    mockDataExamples: JSON.stringify(mockExamples, null, 2),
    integrationGuide,
  };
}
