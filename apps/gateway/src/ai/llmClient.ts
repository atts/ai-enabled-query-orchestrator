export async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch(process.env.LLM_ENDPOINT!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const json = await res.json();
  return json.choices[0].message.content;
}
