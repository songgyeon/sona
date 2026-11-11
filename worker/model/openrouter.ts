/* 대사 모델. 오픈라우터로 부른다.
   열쇠(OPENROUTER_API_KEY)는 Cloudflare 대시보드에 넣는다. 저장소에는 적지 않는다. */

import type { Model, ModelCall, ModelOut } from './index';
import { systemText } from './index';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ChatOut {
  choices?: { message?: { content?: unknown; reasoning?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 받은 것에서 대사와 사고 과정을 가른다. 사고 과정은 대사에 섞지 않는다 */
export function readOut(out: unknown): Omit<ModelOut, 'ms'> {
  const o = (out ?? {}) as ChatOut;
  const msg = o.choices?.[0]?.message;
  const thinking = str(msg?.reasoning);
  return {
    text: str(msg?.content),
    thinking: thinking.length > 0 ? thinking : null,
    tokensIn: o.usage?.prompt_tokens ?? null,
    tokensOut: o.usage?.completion_tokens ?? null,
  };
}

export class ModelError extends Error {}

export function openRouter(apiKey: string, modelId: string, fetcher: typeof fetch = fetch): Model {
  return {
    id: modelId,
    async run(call: ModelCall): Promise<ModelOut> {
      const t0 = Date.now();
      const res = await fetcher(URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-title': 'Sona',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: systemText(call.layers) },
            { role: 'user', content: call.user },
          ],
          temperature: call.temperature,
          max_tokens: call.maxTokens,
        }),
      });
      const data = (await res.json().catch(() => null)) as ChatOut | null;
      if (!res.ok || data?.error) {
        throw new ModelError(`오픈라우터 ${res.status}: ${data?.error?.message ?? '답을 읽지 못했다'}`);
      }
      return { ...readOut(data), ms: Date.now() - t0 };
    },
  };
}
