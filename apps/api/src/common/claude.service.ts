import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { Ctx } from './context';
import { bad } from './errors';

type Effort = 'low' | 'medium' | 'high';
type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

/** A tool the model may call; `run` executes it with the caller's own permissions and business. */
export interface AiTool {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool['input_schema'];
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
/** Tool results are cut to this many characters so one large report cannot flood the request. */
const MAX_RESULT_CHARS = 12_000;

/**
 * The one place the API talks to Claude. Every feature that sends business data out goes through `assertEnabled`,
 * which needs both the server key (ANTHROPIC_API_KEY) and the business's own "AI features" switch in Settings.
 * Callers only ever pass data already read with the user's own scope, so one business's data never reaches another's.
 */
@Injectable()
export class ClaudeService {
  private readonly log = new Logger('AI');
  private client: Anthropic | null = null;

  /** True when the server has a key for Claude. */
  configured() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  /** True when this business has turned AI features on and the server can reach Claude. */
  enabled(ctx: Ctx) {
    return this.configured() && ctx.settings.aiEnabled === true;
  }

  assertEnabled(ctx: Ctx) {
    if (!this.configured()) throw bad('AI features are not set up on this server', 'ai.errors.notConfigured');
    if (ctx.settings.aiEnabled !== true) throw bad('AI features are turned off for this business', 'ai.errors.off');
  }

  private api() {
    this.client ??= new Anthropic({ timeout: 90_000, maxRetries: 2 });
    return this.client;
  }

  private async call(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'>) {
    try {
      const res = await this.api().beta.messages.create({
        model: MODEL,
        // If the model declines, the API retries the request on a fallback model by itself.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        ...params,
      });
      if (res.stop_reason === 'refusal') throw bad('The AI could not help with this request', 'ai.errors.refused');
      return res;
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ServiceUnavailableException({ message: 'The AI is busy, try again in a minute', code: 'ai.errors.busy' });
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        this.log.error(`Claude rejected the server key: ${e.message}`);
        throw new ServiceUnavailableException({ message: 'AI features are not set up on this server', code: 'ai.errors.notConfigured' });
      }
      if (e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)) {
        this.log.warn(`Claude unavailable: ${e.message}`);
        throw new ServiceUnavailableException({ message: 'The AI is not reachable right now', code: 'ai.errors.unavailable' });
      }
      throw e;
    }
  }

  private static text(res: Anthropic.Beta.BetaMessage) {
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }

  /** One request whose answer must match `schema` (a JSON schema). Returns the parsed object. */
  async json<T>(opts: { system: string; content: Block[]; schema: Record<string, unknown>; effort?: Effort; maxTokens?: number }): Promise<T> {
    const res = await this.call({
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      output_config: { effort: opts.effort ?? 'low', format: { type: 'json_schema', schema: opts.schema } },
      messages: [{ role: 'user', content: opts.content }],
    });
    try {
      return JSON.parse(ClaudeService.text(res)) as T;
    } catch {
      throw new ServiceUnavailableException({ message: 'The AI gave an unreadable answer, try again', code: 'ai.errors.unavailable' });
    }
  }

  /**
   * Runs a question through a tool loop: the model calls the given tools (each runs with the user's own scope) and
   * then answers. Returns the answer and the names of the tools it used.
   */
  async withTools(opts: { system: string; messages: Msg[]; tools: AiTool[]; effort?: Effort; maxSteps?: number }) {
    const messages = [...opts.messages];
    const used: string[] = [];
    const defs = opts.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
      const res = await this.call({ max_tokens: 8000, system: opts.system, tools: defs, output_config: { effort: opts.effort ?? 'medium' }, messages });
      if (res.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: res.content });
        continue;
      }
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !calls.length) return { answer: ClaudeService.text(res), used };
      messages.push({ role: 'assistant', content: res.content });
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const tool = opts.tools.find((t) => t.name === c.name);
          used.push(c.name);
          if (!tool) return { type: 'tool_result', tool_use_id: c.id, content: 'Unknown tool', is_error: true };
          try {
            const out = JSON.stringify(await tool.run((c.input ?? {}) as Record<string, unknown>));
            return { type: 'tool_result', tool_use_id: c.id, content: out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + ' …(cut short)' : out };
          } catch (e) {
            const msg = (e as { response?: { message?: string } }).response?.message ?? (e as Error).message;
            return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${msg}`, is_error: true };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    return { answer: '', used };
  }
}
