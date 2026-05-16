// PII & Compliance Scanner
// Introspects the gateway schema and flags fields that likely contain
// personally identifiable information, with GDPR/CCPA remediation guidance.

const INTROSPECT_ALL_TYPES = `
  {
    __schema {
      types {
        name
        kind
        fields {
          name
        }
      }
    }
  }
`;

const SUBGRAPH_URLS: Record<string, string> = {
  products: 'http://localhost:4001/graphql',
  inventory: 'http://localhost:4002/graphql',
  cart: 'http://localhost:4003/graphql',
  discovery: 'http://localhost:4004/graphql',
};

const PII_RULES: {
  pattern: RegExp;
  category: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendation: string;
}[] = [
  {
    pattern: /password|passwd|secret|credential|token|apiKey/i,
    category: 'Credentials',
    riskLevel: 'CRITICAL',
    recommendation: 'NEVER expose credentials in GraphQL responses. Remove or replace with a boolean hasPassword field.',
  },
  {
    pattern: /credit.?card|card.?number|cvv|ccv|pan\b/i,
    category: 'Payment Card Data',
    riskLevel: 'CRITICAL',
    recommendation: 'PCI-DSS compliance required. Use tokenized references only. Never return raw card numbers.',
  },
  {
    pattern: /ssn|social.?security|national.?id|passport/i,
    category: 'Government Identifier',
    riskLevel: 'CRITICAL',
    recommendation: 'Must be encrypted at rest and in transit. Restrict to authorized resolvers with audit logging.',
  },
  {
    pattern: /\bemail\b|emailAddress/i,
    category: 'Email Address',
    riskLevel: 'HIGH',
    recommendation: 'Require authentication. Consider masking (u***@domain.com) in non-admin contexts.',
  },
  {
    pattern: /phone|mobile|tel\b|phoneNumber/i,
    category: 'Phone Number',
    riskLevel: 'HIGH',
    recommendation: 'Require authentication. Mask last 7 digits in public-facing contexts.',
  },
  {
    pattern: /\baddress\b|street|city\b|zipCode|postalCode/i,
    category: 'Physical Address',
    riskLevel: 'HIGH',
    recommendation: 'Restrict to authenticated users who own the record. Do not expose in list queries.',
  },
  {
    pattern: /birth.?date|dateOfBirth|dob\b|\bage\b/i,
    category: 'Date of Birth / Age',
    riskLevel: 'HIGH',
    recommendation: 'GDPR Article 9 sensitive data. Require explicit consent and authentication.',
  },
  {
    pattern: /salary|income|wage|compensation/i,
    category: 'Financial Information',
    riskLevel: 'HIGH',
    recommendation: 'Restrict to HR/admin roles with role-based access control.',
  },
  {
    pattern: /health|medical|diagnosis|prescription|condition/i,
    category: 'Health Information',
    riskLevel: 'HIGH',
    recommendation: 'HIPAA may apply. Require explicit consent, audit all access.',
  },
  {
    pattern: /ip.?address|ipv4|ipv6|userAgent/i,
    category: 'Network Identifier',
    riskLevel: 'MEDIUM',
    recommendation: 'Anonymize in logs. Do not expose raw IPs in client-facing APIs.',
  },
  {
    pattern: /location|latitude|longitude|gps|coordinates/i,
    category: 'Geolocation',
    riskLevel: 'MEDIUM',
    recommendation: 'Require explicit user consent per GDPR Article 6. Allow opt-out.',
  },
  {
    pattern: /name\b|firstName|lastName|fullName/i,
    category: 'Personal Name',
    riskLevel: 'LOW',
    recommendation: 'Generally safe but restrict full names in combined queries with other PII fields.',
  },
];

export type PIIField = {
  subgraph: string;
  typeName: string;
  fieldName: string;
  piiCategory: string;
  riskLevel: string;
  recommendation: string;
};

export type PIIReport = {
  scannedAt: string;
  totalFieldsScanned: number;
  piiFields: PIIField[];
  riskLevel: string;
  summary: string;
};

async function introspectTypes(
  url: string,
): Promise<{ name: string; fields: { name: string }[] }[]> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECT_ALL_TYPES }),
    });
    const json = (await res.json()) as {
      data?: { __schema?: { types: { name: string; kind: string; fields: { name: string }[] | null }[] } };
    };
    return (json.data?.__schema?.types ?? []).filter(
      (t) => t.kind === 'OBJECT' && !t.name.startsWith('__') && t.fields,
    ) as { name: string; fields: { name: string }[] }[];
  } catch {
    return [];
  }
}

export async function scanSchemaForPII(gatewayUrl: string): Promise<PIIReport> {
  const scannedAt = new Date().toISOString();
  const piiFields: PIIField[] = [];
  let totalFieldsScanned = 0;

  // Scan each subgraph directly for full type visibility
  for (const [subgraph, url] of Object.entries(SUBGRAPH_URLS)) {
    const types = await introspectTypes(url);
    for (const type of types) {
      for (const field of type.fields) {
        totalFieldsScanned++;
        for (const rule of PII_RULES) {
          if (rule.pattern.test(field.name)) {
            piiFields.push({
              subgraph,
              typeName: type.name,
              fieldName: field.name,
              piiCategory: rule.category,
              riskLevel: rule.riskLevel,
              recommendation: rule.recommendation,
            });
            break; // one match per field is enough
          }
        }
      }
    }
  }

  const hasCritical = piiFields.some((f) => f.riskLevel === 'CRITICAL');
  const hasHigh = piiFields.some((f) => f.riskLevel === 'HIGH');
  const overallRisk = hasCritical ? 'CRITICAL' : hasHigh ? 'HIGH' : piiFields.length > 0 ? 'MEDIUM' : 'LOW';

  const summary = piiFields.length === 0
    ? 'No PII fields detected. Schema appears compliant.'
    : `Found ${piiFields.length} PII field(s) across ${new Set(piiFields.map(f => f.subgraph)).size} subgraph(s). ${hasCritical ? 'CRITICAL issues require immediate attention.' : 'Review recommendations and apply access controls.'}`;

  return { scannedAt, totalFieldsScanned, piiFields, riskLevel: overallRisk, summary };
}
