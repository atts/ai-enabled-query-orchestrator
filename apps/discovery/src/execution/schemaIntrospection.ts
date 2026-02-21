// Introspects the gateway's composed schema to get all available Product fields.
// Called at request time so the gateway is guaranteed to be running.

const INTROSPECTION_QUERY = `
  {
    __type(name: "Product") {
      fields {
        name
      }
    }
  }
`;

export async function getProductFields(gatewayUrl: string): Promise<string[]> {
  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });

  const json = await res.json() as {
    data?: { __type?: { fields: { name: string }[] } };
  };

  return (json.data?.__type?.fields ?? []).map((f) => f.name);
}
