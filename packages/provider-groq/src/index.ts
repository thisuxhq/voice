import type {
  LLMProvider,
  Message,
  LLMOptions,
  LLMChunk,
} from "@thisux/voice-core";

export interface GroqOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

/**
 * Groq chat completions (OpenAI-compatible streaming API).
 */
export function groq(options: GroqOptions): LLMProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async *generate(
      messages: Message[],
      llmOptions?: LLMOptions,
    ): AsyncIterable<LLMChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => {
          const msg: Record<string, unknown> = {
            role: m.role,
            content: m.content,
          };
          if (m.name) msg.name = m.name;
          if (m.toolCallId) msg.tool_call_id = m.toolCallId;
          if (m.toolCalls) {
            msg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            }));
          }
          return msg;
        }),
        stream: true,
      };

      if (llmOptions?.tools?.length) {
        body.tools = llmOptions.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? { type: "object", properties: {} },
          },
        }));
      }

      if (llmOptions?.temperature !== undefined) {
        body.temperature = llmOptions.temperature;
      }
      if (llmOptions?.maxTokens !== undefined) {
        body.max_tokens = llmOptions.maxTokens;
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: llmOptions?.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`Groq LLM failed: ${res.status} ${text}`);
      }

      yield* parseSseChatStream(res.body);
      yield { type: "done" };
    },
  };
}

async function* parseSseChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLMChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolArgs = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          for (const tc of toolArgs.values()) {
            yield {
              type: "tool_call",
              toolCall: {
                id: tc.id,
                name: tc.name,
                arguments: tc.args,
              },
            };
          }
          return;
        }

        let json: {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        try {
          json = JSON.parse(data) as typeof json;
        } catch {
          continue;
        }

        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "text", text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolArgs.get(tc.index) ?? {
              id: tc.id ?? `call_${tc.index}`,
              name: "",
              args: "",
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolArgs.set(tc.index, existing);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  for (const tc of toolArgs.values()) {
    yield {
      type: "tool_call",
      toolCall: {
        id: tc.id,
        name: tc.name,
        arguments: tc.args,
      },
    };
  }
}
