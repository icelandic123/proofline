// Backend for AG Studio's AI assistant. Studio runs the agent loop and its
// dashboard tools in the browser; each turn it sends us the conversation and
// tool schemas (AgLlmRequest), we ask a Workers AI model, and return its
// text and tool calls as an AgLlmResponse.

import type { Ctx } from './agent';

interface Item {
  kind?: 'input' | 'output';
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  role?: 'user' | 'system' | 'assistant';
  content?: { type: string; text?: string; refusal?: string }[];
  callId?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

interface StudioRequest {
  input: Item[];
  instructions?: string;
  tools?: { name: string; description?: string; parameters?: Record<string, unknown>; kind?: string }[];
  toolChoice?: unknown;
}

export const STUDIO_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MAX_TURNS_PER_HOUR = 150;

const textOf = (item: Item) =>
  (item.content ?? [])
    .map((c) => c.text ?? c.refusal ?? '')
    .filter(Boolean)
    .join('\n');

/** Workers AI's tool schema wants a type and description on every property. */
export function cleanSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => {
          const cleaned = (cleanSchema(pv) ?? {}) as Record<string, unknown>;
          const type = cleaned.type ?? (cleaned.anyOf || cleaned.oneOf ? 'object' : 'string');
          return [pk, { ...cleaned, type, description: cleaned.description ?? pk }];
        }),
      );
    } else out[k] = cleanSchema(v);
  }
  return out;
}

export function toMessages(req: StudioRequest) {
  const messages: { role: string; content: string; tool_call_id?: string; name?: string }[] = [];
  const system = [req.instructions ?? ''];
  for (const item of req.input ?? []) {
    if (item.type === 'message') {
      const text = textOf(item);
      if (!text) continue;
      if (item.role === 'system') system.push(text);
      else messages.push({ role: item.kind === 'output' || item.role === 'assistant' ? 'assistant' : 'user', content: text });
    } else if (item.type === 'function_call') {
      let args: unknown = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = {};
      }
      messages.push({ role: 'assistant', content: JSON.stringify({ name: item.name, arguments: args }) });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', content: String(item.output ?? '').slice(0, 12000), tool_call_id: item.callId, name: item.name });
    }
  }
  if (req.toolChoice && typeof req.toolChoice === 'object' && 'name' in req.toolChoice) {
    system.push(`Call the tool "${(req.toolChoice as { name: string }).name}" now.`);
  }
  return [{ role: 'system', content: system.filter(Boolean).join('\n\n') }, ...messages];
}

let seq = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;
const message = (text: string) => ({ kind: 'output', type: 'message', id: newId('msg'), role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toResponse(out: any, model: string) {
  const text: string = typeof out?.response === 'string' ? out.response : out?.choices?.[0]?.message?.content ?? '';
  const calls = out?.tool_calls ?? out?.choices?.[0]?.message?.tool_calls ?? [];
  const output: unknown[] = [];
  if (text && !calls.length) output.push(message(text));
  for (const c of calls) {
    const fn = c.function ?? c;
    const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    output.push({ kind: 'output', type: 'function_call', id: newId('fc'), callId: c.id ?? newId('call'), name: fn.name, arguments: args, status: 'completed' });
  }
  if (!output.length) output.push(message('Done.'));
  const u = out?.usage;
  return {
    id: newId('resp'),
    createdAt: Math.floor(Date.now() / 1000),
    status: 'completed',
    output,
    usage: u ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 } : undefined,
    model,
  };
}

export async function studioAgent(ctx: Ctx & { ai?: Ai; model?: string }, body: unknown) {
  const req = body as StudioRequest;
  const fail = (msg: string) => ({ id: newId('resp'), createdAt: Math.floor(Date.now() / 1000), status: 'failed', error: { code: 'proofline', message: msg }, output: [] });
  if (!ctx.ai) return fail('AI is not configured on this deployment.');

  // An hourly budget keeps the free Workers AI allowance available for every visitor.
  const hourKey = `studio_turns_${new Date().toISOString().slice(0, 13)}`;
  const used = Number((await ctx.db.getSetting(hourKey)) ?? 0);
  if (used >= MAX_TURNS_PER_HOUR) return fail('The AI assistant is busy. Please try again later.');
  await ctx.db.setSetting(hourKey, String(used + 1));

  const tools = (req.tools ?? [])
    .filter((t) => (t.kind ?? 'client') === 'client')
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? t.name, parameters: cleanSchema(t.parameters ?? { type: 'object', properties: {} }) } }));
  const model = ctx.model ?? STUDIO_MODEL;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await ctx.ai.run(model as any, { messages: toMessages(req), tools: tools.length ? tools : undefined, max_tokens: 1500, temperature: 0.2 } as any);
    return toResponse(out, model);
  } catch (e) {
    return fail(`The AI model could not answer: ${(e as Error).message}`);
  }
}
