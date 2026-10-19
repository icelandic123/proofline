import { describe, expect, it } from 'vitest';
import { cleanSchema, toMessages, toResponse } from './studio';

describe('studio adapter', () => {
  it('turns Studio items into chat messages', () => {
    const msgs = toMessages({
      instructions: 'Build dashboards.',
      input: [
        { kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'Add a chart' }] },
        { kind: 'output', type: 'function_call', callId: 'c1', name: 'add_widget', arguments: '{"type":"bar"}' },
        { kind: 'input', type: 'function_call_output', callId: 'c1', output: 'ok' },
      ],
    });
    expect(msgs[0]).toEqual({ role: 'system', content: 'Build dashboards.' });
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });

  it('returns tool calls with JSON string arguments', () => {
    const r = toResponse({ tool_calls: [{ name: 'add_widget', arguments: { type: 'bar' } }] }, 'm');
    const call = r.output[0] as { type: string; arguments: string; callId: string };
    expect(call.type).toBe('function_call');
    expect(JSON.parse(call.arguments)).toEqual({ type: 'bar' });
    expect(call.callId).toBeTruthy();
  });

  it('adds missing types and descriptions to tool schemas', () => {
    const s = cleanSchema({ type: 'object', properties: { a: {}, b: { type: 'number', description: 'x' } } }) as { properties: Record<string, { type: string; description: string }> };
    expect(s.properties.a).toEqual({ type: 'string', description: 'a' });
    expect(s.properties.b.description).toBe('x');
  });
});
