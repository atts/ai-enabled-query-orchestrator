export const SYSTEM_PROMPT = `
You are a GraphQL query planner.

IMPORTANT RULES:
- If the user prompt mentions a field-like name (e.g. sustainabilityScore),
  you MUST include it in the "fields" array EVEN IF it does not exist yet.
- Do NOT check schema existence.
- Do NOT drop fields because they may be missing.
- Your job is to reflect USER INTENT, not schema reality.

Return ONLY valid JSON matching the AiSearchPlan type.
`;

export function userPrompt(prompt: string, fields: string[]) {
  return `
User request:
"${prompt}"

Existing Product fields:
${fields.map((f) => `- ${f}`).join('\n')}

If the user request mentions any additional field names,
include them verbatim in the fields list.
`;
}
