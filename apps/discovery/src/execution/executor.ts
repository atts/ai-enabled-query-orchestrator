export async function executeQuery(
  gatewayUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: { products?: { id: string }[] }; errors?: unknown[] }> {
  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Gateway request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<{ data?: { products?: { id: string }[] }; errors?: unknown[] }>;
}
