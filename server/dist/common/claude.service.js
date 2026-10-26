"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ClaudeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeService = void 0;
const common_1 = require("@nestjs/common");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const errors_1 = require("./errors");
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
/** Tool results are cut to this many characters so one large report cannot flood the request. */
const MAX_RESULT_CHARS = 12_000;
/**
 * The one place the API talks to Claude. Every feature that sends business data out goes through `assertEnabled`,
 * which needs both the server key (ANTHROPIC_API_KEY) and the business's own "AI features" switch in Settings.
 * Callers only ever pass data already read with the user's own scope, so one business's data never reaches another's.
 */
let ClaudeService = ClaudeService_1 = class ClaudeService {
    log = new common_1.Logger('AI');
    client = null;
    /** True when the server has a key for Claude. */
    configured() {
        return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    }
    /** True when this business has turned AI features on and the server can reach Claude. */
    enabled(ctx) {
        return this.configured() && ctx.settings.aiEnabled === true;
    }
    assertEnabled(ctx) {
        if (!this.configured())
            throw (0, errors_1.bad)('AI features are not set up on this server', 'ai.errors.notConfigured');
        if (ctx.settings.aiEnabled !== true)
            throw (0, errors_1.bad)('AI features are turned off for this business', 'ai.errors.off');
    }
    api() {
        this.client ??= new sdk_1.default({ timeout: 90_000, maxRetries: 2 });
        return this.client;
    }
    async call(params) {
        try {
            const res = await this.api().beta.messages.create({
                model: MODEL,
                // If the model declines, the API retries the request on a fallback model by itself.
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                ...params,
            });
            if (res.stop_reason === 'refusal')
                throw (0, errors_1.bad)('The AI could not help with this request', 'ai.errors.refused');
            return res;
        }
        catch (e) {
            if (e instanceof sdk_1.default.RateLimitError)
                throw new common_1.ServiceUnavailableException({ message: 'The AI is busy, try again in a minute', code: 'ai.errors.busy' });
            if (e instanceof sdk_1.default.AuthenticationError || e instanceof sdk_1.default.PermissionDeniedError) {
                this.log.error(`Claude rejected the server key: ${e.message}`);
                throw new common_1.ServiceUnavailableException({ message: 'AI features are not set up on this server', code: 'ai.errors.notConfigured' });
            }
            if (e instanceof sdk_1.default.APIConnectionError || (e instanceof sdk_1.default.APIError && (e.status ?? 0) >= 500)) {
                this.log.warn(`Claude unavailable: ${e.message}`);
                throw new common_1.ServiceUnavailableException({ message: 'The AI is not reachable right now', code: 'ai.errors.unavailable' });
            }
            throw e;
        }
    }
    static text(res) {
        return res.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim();
    }
    /** One request whose answer must match `schema` (a JSON schema). Returns the parsed object. */
    async json(opts) {
        const res = await this.call({
            max_tokens: opts.maxTokens ?? 4000,
            system: opts.system,
            output_config: { effort: opts.effort ?? 'low', format: { type: 'json_schema', schema: opts.schema } },
            messages: [{ role: 'user', content: opts.content }],
        });
        try {
            return JSON.parse(ClaudeService_1.text(res));
        }
        catch {
            throw new common_1.ServiceUnavailableException({ message: 'The AI gave an unreadable answer, try again', code: 'ai.errors.unavailable' });
        }
    }
    /**
     * Runs a question through a tool loop: the model calls the given tools (each runs with the user's own scope) and
     * then answers. Returns the answer and the names of the tools it used.
     */
    async withTools(opts) {
        const messages = [...opts.messages];
        const used = [];
        const defs = opts.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
        for (let step = 0; step < (opts.maxSteps ?? 8); step++) {
            const res = await this.call({ max_tokens: 8000, system: opts.system, tools: defs, output_config: { effort: opts.effort ?? 'medium' }, messages });
            if (res.stop_reason === 'pause_turn') {
                messages.push({ role: 'assistant', content: res.content });
                continue;
            }
            const calls = res.content.filter((b) => b.type === 'tool_use');
            if (res.stop_reason !== 'tool_use' || !calls.length)
                return { answer: ClaudeService_1.text(res), used };
            messages.push({ role: 'assistant', content: res.content });
            const results = await Promise.all(calls.map(async (c) => {
                const tool = opts.tools.find((t) => t.name === c.name);
                used.push(c.name);
                if (!tool)
                    return { type: 'tool_result', tool_use_id: c.id, content: 'Unknown tool', is_error: true };
                try {
                    const out = JSON.stringify(await tool.run((c.input ?? {})));
                    return { type: 'tool_result', tool_use_id: c.id, content: out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + ' …(cut short)' : out };
                }
                catch (e) {
                    const msg = e.response?.message ?? e.message;
                    return { type: 'tool_result', tool_use_id: c.id, content: `Error: ${msg}`, is_error: true };
                }
            }));
            messages.push({ role: 'user', content: results });
        }
        return { answer: '', used };
    }
};
exports.ClaudeService = ClaudeService;
exports.ClaudeService = ClaudeService = ClaudeService_1 = __decorate([
    (0, common_1.Injectable)()
], ClaudeService);
//# sourceMappingURL=claude.service.js.map