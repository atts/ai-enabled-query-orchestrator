import { AiSearchPlan } from './types';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import { callLLM } from './llmClient';

export async function generatePlan(
  prompt: string,
  fields: string[],
): Promise<AiSearchPlan> {
  const raw = await callLLM(SYSTEM_PROMPT, userPrompt(prompt, fields));

  return JSON.parse(raw);
}
