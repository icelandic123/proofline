import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from 'ag-studio';

/**
 * AgLlmAdapter that forwards Studio's turn request to YOUR backend and expects an AgLlmResponse
 * back (see server/studio-agent.ts). No provider SDK, no API key in the browser.
 * Non-streaming: the final response is replayed to Studio as stream events.
 */
export function backendAdapter(endpoint = '/api/studio-agent'): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(request),
        signal: options?.signal, // aborts the fetch when the user presses Stop
      }).then(async (res) => {
        if (!res.ok) throw new Error(`studio-agent ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return (await res.json()) as AgLlmResponse;
      });
      complete.catch(() => {}); // the runner awaits `complete` itself; avoid a duplicate unhandled rejection

      async function* stream(): AsyncGenerator<AgAiEvent> {
        const response = await complete.catch(() => undefined);
        if (!response) return; // failure is reported by `complete` rejecting
        for (const item of response.output) {
          if (item.type === 'message') {
            for (const part of item.content) {
              if (part.type === 'text') yield { type: 'TEXT_MESSAGE_CHUNK', messageId: item.id, role: 'assistant', delta: part.text };
            }
          } else if (item.type === 'function_call') {
            yield { type: 'TOOL_CALL_CHUNK', toolCallId: item.callId, toolCallName: item.name, delta: item.arguments };
          }
        }
      }
      return { stream: { [Symbol.asyncIterator]: () => stream() }, complete };
    },
  };
}
