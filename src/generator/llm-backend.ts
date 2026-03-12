import type { LanguageModel } from 'ai';
import { generateObject, generateText } from 'ai';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  createClaudeCliRunner,
  createCodexCliRunner,
  createGeminiCliRunner,
  isCliAvailable,
} from '../ai/agent-runner.js';
import type { ModelProvider } from '../config/model-config.js';
import { loadValidatedConfig, resolveApiKey, resolveModelFromResolvedConfig } from '../config/model-config.js';
import type { AgentRunner } from '../core/types.js';
import { logger } from '../util/logger.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface StructuredResult<T> {
  object: T;
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult {
  text: string;
}

export interface GeneratorLlmBackend {
  generateStructured<T extends z.ZodType>(options: {
    system: string;
    prompt: string;
    schema: T;
    abortSignal?: AbortSignal;
  }): Promise<StructuredResult<z.infer<T>>>;

  generatePlainText(options: { system: string; prompt: string }): Promise<TextResult>;
}

// ---------------------------------------------------------------------------
// CLI Implementation (default — uses claude -p / codex / gemini)
// ---------------------------------------------------------------------------

export class CliLlmBackend implements GeneratorLlmBackend {
  constructor(
    private runner: AgentRunner,
    private cwd: string
  ) {}

  async generateStructured<T extends z.ZodType>(options: {
    system: string;
    prompt: string;
    schema: T;
    abortSignal?: AbortSignal;
  }): Promise<StructuredResult<z.infer<T>>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema expects Zod v3 types
    const jsonSchema = JSON.stringify(zodToJsonSchema(options.schema as any), null, 2);
    const jsonInstruction = `\n\nCRITICAL: Your response must be ONLY a raw JSON object. No preamble, no explanation, no markdown fences, no "here is" or "I will" text. The very first character of your response MUST be \`{\`. Respond with nothing but valid JSON matching this schema:\n\n${jsonSchema}`;

    const result = await this.runner.execute({
      systemPrompt: options.system + jsonInstruction,
      prompt: options.prompt,
      cwd: this.cwd,
      abortSignal: options.abortSignal,
    });

    const jsonText = extractJson(result.output);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error(`CLI backend returned invalid JSON: ${jsonText.slice(0, 200)}...`);
    }

    const validated = options.schema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i: z.ZodIssue) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`CLI backend output failed schema validation: ${issues}`);
    }

    return { object: validated.data, inputTokens: 0, outputTokens: 0 };
  }

  async generatePlainText(options: { system: string; prompt: string }): Promise<TextResult> {
    const result = await this.runner.execute({
      systemPrompt: options.system,
      prompt: options.prompt,
      cwd: this.cwd,
    });
    return { text: result.output };
  }
}

// ---------------------------------------------------------------------------
// SDK Implementation (fallback — requires API key)
// ---------------------------------------------------------------------------

export class SdkLlmBackend implements GeneratorLlmBackend {
  constructor(private model: LanguageModel) {}

  async generateStructured<T extends z.ZodType>(options: {
    system: string;
    prompt: string;
    schema: T;
    abortSignal?: AbortSignal;
  }): Promise<StructuredResult<z.infer<T>>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generateObject has complex generics that don't align with our generic constraint
    const result = await generateObject({
      model: this.model,
      schema: options.schema as any,
      system: options.system,
      prompt: options.prompt,
      abortSignal: options.abortSignal,
    });
    return {
      object: result.object as z.infer<T>,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  }

  async generatePlainText(options: { system: string; prompt: string }): Promise<TextResult> {
    const result = await generateText({
      model: this.model,
      system: options.system,
      prompt: options.prompt,
    });
    return { text: result.text };
  }
}

// ---------------------------------------------------------------------------
// Factory — CLI default, SDK fallback
// ---------------------------------------------------------------------------

const PROVIDER_CLI: Record<ModelProvider, string> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
};

function createCliRunnerForProvider(provider: ModelProvider): AgentRunner {
  switch (provider) {
    case 'anthropic':
      return createClaudeCliRunner();
    case 'openai':
      return createCodexCliRunner();
    case 'google':
      return createGeminiCliRunner();
  }
}

/**
 * Resolve the LLM backend for rule generation.
 * Default: CLI agent (claude -p, codex, gemini).
 * Fallback: AI SDK with API key (only when no CLI agent is installed).
 */
export function resolveGeneratorBackend(configPath?: string): GeneratorLlmBackend {
  const config = loadValidatedConfig(configPath);
  const provider = config.model.provider;
  const cliCommand = PROVIDER_CLI[provider];

  if (isCliAvailable(cliCommand)) {
    logger.debug(`[generator] Using CLI backend (${cliCommand})`);
    const runner = createCliRunnerForProvider(provider);
    return new CliLlmBackend(runner, process.cwd());
  }

  // Fallback: SDK (requires API key)
  logger.debug(`[generator] CLI ${cliCommand} not available, falling back to SDK`);
  const apiKey = resolveApiKey(config);
  const model = resolveModelFromResolvedConfig({
    provider,
    model: config.model.name,
    apiKey,
  });
  return new SdkLlmBackend(model);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJson(text: string): string {
  let cleaned = text.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!.trim();
  }

  // Find the first { or [ — skip any preamble text the LLM added
  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  if (objStart === -1) start = arrStart;
  else if (arrStart === -1) start = objStart;
  else start = Math.min(objStart, arrStart);

  if (start > 0) {
    cleaned = cleaned.slice(start);
  }

  // Trim trailing non-JSON (e.g. trailing explanation after the closing brace)
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end > 0) {
    cleaned = cleaned.slice(0, end + 1);
  }

  return cleaned.trim();
}
