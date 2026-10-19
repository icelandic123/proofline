// Thin wrapper over Cloudflare Workers AI (free tier). Every caller has a
// deterministic fallback, so the app keeps working if the daily free
// allowance runs out or the model returns something unusable.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  model: string;
}

export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export class Llm {
  constructor(private ai: Ai | undefined, readonly model = DEFAULT_MODEL) {}

  get available() {
    return !!this.ai;
  }

  async chat(messages: ChatMessage[], opts: { tools?: ToolSpec[]; maxTokens?: number; temperature?: number } = {}): Promise<ChatResult> {
    if (!this.ai) throw new Error('Workers AI binding is not configured');
    const input: Record<string, unknown> = {
      messages,
      max_tokens: opts.maxTokens ?? 900,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.tools?.length) input.tools = opts.tools.map((t) => ({ type: 'function', function: t }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await this.ai.run(this.model as any, input as any)) as any;
    return { text: extractText(out), toolCalls: extractToolCalls(out), model: this.model };
  }

  /** Asks for a JSON object and parses it leniently. */
  async json<T>(messages: ChatMessage[], maxTokens = 900): Promise<{ value: T; model: string }> {
    const r = await this.chat(messages, { maxTokens });
    return { value: parseJsonLoose<T>(r.text), model: r.model };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(out: any): string {
  if (typeof out === 'string') return out;
  if (typeof out?.response === 'string') return out.response;
  if (out?.response && typeof out.response === 'object') return JSON.stringify(out.response);
  const choice = out?.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  // Responses-API shaped output (gpt-oss models).
  const parts = (out?.output ?? []).flatMap((o: any) => o?.content ?? []).filter((c: any) => c?.type === 'output_text');
  return parts.map((p: any) => p.text).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractToolCalls(out: any): ToolCall[] {
  const raw = out?.tool_calls ?? out?.choices?.[0]?.message?.tool_calls ?? [];
  return raw.map((c: any) => {
    const fn = c.function ?? c;
    let args = fn.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    return { id: c.id, name: fn.name, arguments: args };
  });
}

export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model did not return JSON');
  return JSON.parse(body.slice(start, end + 1)) as T;
}
