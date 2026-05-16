// Query Intelligence — Explainer & Cost Analyzer
// Uses the graphql package's parse() to inspect query ASTs without calling any
// external service. Works entirely offline.

import {
  parse,
  OperationDefinitionNode,
  FieldNode,
  SelectionSetNode,
  DocumentNode,
} from 'graphql';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QueryExplanation = {
  query: string;
  plainEnglish: string;
  subgraphsInvolved: string[];
  estimatedComplexity: string;
  fieldCount: number;
  operationType: string;
};

export type CostAnalysis = {
  query: string;
  estimatedCost: number;
  depth: number;
  fieldCount: number;
  federationJumps: number;
  riskLevel: string;
  recommendations: string[];
};

// ─── Federation type → subgraph mapping (from known schema) ──────────────────

const TYPE_TO_SUBGRAPH: Record<string, string> = {
  Product: 'products',
  InventoryItem: 'inventory',
  CartItem: 'cart',
  Cart: 'cart',
  SearchResult: 'discovery',
  AiSearchResponse: 'discovery',
};

// Fields that are known to trigger federation entity resolution (cross-subgraph jump)
const FEDERATION_TRIGGER_TYPES = new Set(['Product', 'CartItem', 'InventoryItem']);

// ─── AST helpers ─────────────────────────────────────────────────────────────

function collectFields(
  selectionSet: SelectionSetNode | undefined,
  depth = 0,
): { fieldNames: string[]; maxDepth: number } {
  if (!selectionSet) return { fieldNames: [], maxDepth: depth };

  let allFields: string[] = [];
  let maxDepth = depth;

  for (const sel of selectionSet.selections) {
    if (sel.kind === 'Field') {
      const field = sel as FieldNode;
      allFields.push(field.name.value);
      if (field.selectionSet) {
        const nested = collectFields(field.selectionSet, depth + 1);
        allFields = allFields.concat(nested.fieldNames);
        maxDepth = Math.max(maxDepth, nested.maxDepth);
      }
    }
  }

  return { fieldNames: allFields, maxDepth };
}

function getTopLevelFields(doc: DocumentNode): string[] {
  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === 'OperationDefinition',
  );
  if (!op?.selectionSet) return [];
  return op.selectionSet.selections
    .filter((s): s is FieldNode => s.kind === 'Field')
    .map((s) => s.name.value);
}

function detectFederationJumps(doc: DocumentNode): number {
  // Count how many top-level fields return types that require cross-subgraph resolution
  const topFields = getTopLevelFields(doc);
  // Simple heuristic: if query touches product + (inventory or cart), that's 2 subgraphs
  const touchedSubgraphs = new Set<string>();
  const allText = doc.definitions.map(() => '').join('');
  void allText;

  for (const field of topFields) {
    if (['products', 'product'].includes(field)) touchedSubgraphs.add('products');
    if (['cart', 'cartItems'].includes(field)) touchedSubgraphs.add('cart');
    if (['inventory', 'inventoryItem'].includes(field)) touchedSubgraphs.add('inventory');
    if (['aiSearch', 'aiSearchResponse'].includes(field)) {
      touchedSubgraphs.add('discovery');
      touchedSubgraphs.add('products'); // discovery always resolves products
    }
  }

  // Each additional subgraph beyond the first = 1 federation jump
  return Math.max(0, touchedSubgraphs.size - 1);
}

function describeField(name: string): string {
  // Convert camelCase field names to readable phrases
  return name
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();
}

// ─── Explainer ───────────────────────────────────────────────────────────────

export function explainQuery(queryStr: string): QueryExplanation {
  let doc: DocumentNode;
  try {
    doc = parse(queryStr);
  } catch (e) {
    return {
      query: queryStr,
      plainEnglish: `Could not parse query: ${(e as Error).message}`,
      subgraphsInvolved: [],
      estimatedComplexity: 'unknown',
      fieldCount: 0,
      operationType: 'unknown',
    };
  }

  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === 'OperationDefinition',
  );

  const operationType = op?.operation ?? 'query';
  const { fieldNames, maxDepth } = collectFields(op?.selectionSet);
  const topLevelFields = getTopLevelFields(doc);
  const federationJumps = detectFederationJumps(doc);

  // Determine subgraphs involved
  const subgraphsInvolved = new Set<string>();
  for (const field of topLevelFields) {
    if (['products', 'product'].includes(field)) subgraphsInvolved.add('products');
    if (['cart'].includes(field)) subgraphsInvolved.add('cart');
    if (['inventory'].includes(field)) subgraphsInvolved.add('inventory');
    if (['aiSearch', 'pendingSchemaProposals'].includes(field)) subgraphsInvolved.add('discovery');
  }
  if (subgraphsInvolved.size === 0) subgraphsInvolved.add('gateway');

  // Build plain English description
  const complexity = fieldNames.length <= 5 ? 'simple' : fieldNames.length <= 15 ? 'moderate' : 'complex';
  const subgraphList = [...subgraphsInvolved].join(' and ');

  let plainEnglish: string;
  if (operationType === 'mutation') {
    plainEnglish = `This is a mutation that modifies data in the ${subgraphList} subgraph(s). ` +
      `It sends ${topLevelFields.map(describeField).join(', ')} ` +
      `and retrieves ${fieldNames.length} field(s) in the response.`;
  } else {
    plainEnglish =
      `This ${complexity} query fetches data from the ${subgraphList} subgraph(s). ` +
      `It requests the following top-level operations: ${topLevelFields.map(describeField).join(', ')}. ` +
      `A total of ${fieldNames.length} field(s) are selected across ${maxDepth + 1} nesting level(s).` +
      (federationJumps > 0
        ? ` The gateway will make ${federationJumps} cross-subgraph federation jump(s) to resolve all fields.`
        : '');
  }

  const estimatedComplexity =
    fieldNames.length <= 5 ? 'Low' : fieldNames.length <= 20 ? 'Medium' : 'High';

  return {
    query: queryStr,
    plainEnglish,
    subgraphsInvolved: [...subgraphsInvolved],
    estimatedComplexity,
    fieldCount: fieldNames.length,
    operationType,
  };
}

// ─── Cost Analyzer ───────────────────────────────────────────────────────────

export function analyzeQueryCost(queryStr: string): CostAnalysis {
  let doc: DocumentNode;
  try {
    doc = parse(queryStr);
  } catch {
    return {
      query: queryStr,
      estimatedCost: -1,
      depth: 0,
      fieldCount: 0,
      federationJumps: 0,
      riskLevel: 'UNKNOWN',
      recommendations: ['Query could not be parsed. Check syntax.'],
    };
  }

  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === 'OperationDefinition',
  );

  const { fieldNames, maxDepth } = collectFields(op?.selectionSet);
  const federationJumps = detectFederationJumps(doc);

  // Cost model: base cost + depth penalty + federation jump penalty
  const baseCost = fieldNames.length * 1;
  const depthPenalty = maxDepth * 5;
  const federationPenalty = federationJumps * 10;
  const estimatedCost = baseCost + depthPenalty + federationPenalty;

  const riskLevel =
    estimatedCost < 20 ? 'LOW' :
    estimatedCost < 50 ? 'MEDIUM' :
    estimatedCost < 100 ? 'HIGH' : 'CRITICAL';

  const recommendations: string[] = [];
  if (maxDepth > 4) recommendations.push(`Query nesting depth (${maxDepth}) is high. Consider flattening or paginating.`);
  if (fieldNames.length > 20) recommendations.push(`Requesting ${fieldNames.length} fields. Use field selection to request only what you need.`);
  if (federationJumps > 2) recommendations.push(`${federationJumps} cross-subgraph federation jumps detected. Consider denormalizing frequently co-requested fields.`);
  if (!fieldNames.includes('id')) recommendations.push('Including id fields enables better gateway caching via entity caching.');
  if (recommendations.length === 0) recommendations.push('Query looks well-structured. No optimizations needed.');

  return {
    query: queryStr,
    estimatedCost,
    depth: maxDepth,
    fieldCount: fieldNames.length,
    federationJumps,
    riskLevel,
    recommendations,
  };
}
