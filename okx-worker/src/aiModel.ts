// Inference provider for Vera's allocation model — ported from
// web/src/lib/server/aiModel.ts with process.env reads converted to explicit
// env params (Workers pass bindings, not process.env).
//
// Precedence: Virtuals compute > Venice AI > direct Anthropic.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Env } from "./env";

const VIRTUALS_BASE_URL = "https://compute.virtuals.io/v1";
const VIRTUALS_MODEL = "anthropic-claude-opus-4-8";
const VENICE_BASE_URL = "https://api.venice.ai/api/v1";
const VENICE_MODEL = "claude-opus-4-7";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

export type AiProvider = "virtuals" | "venice" | "anthropic";

function active(env: Env): { provider: AiProvider; modelId: string } {
  if (env.VIRTUALS_API_KEY) return { provider: "virtuals", modelId: VIRTUALS_MODEL };
  if (env.VENICE_API_KEY) return { provider: "venice", modelId: VENICE_MODEL };
  return { provider: "anthropic", modelId: ANTHROPIC_MODEL };
}

/** The model id that will actually serve the next allocation (for telemetry). */
export function activeModelId(env: Env): string {
  return active(env).modelId;
}

/** True when at least one inference provider is configured. */
export function hasAiProvider(env: Env): boolean {
  return Boolean(env.VIRTUALS_API_KEY || env.VENICE_API_KEY || env.ANTHROPIC_API_KEY);
}

/** Build the language model for an allocation call (Virtuals > Venice > Anthropic). */
export function resolveAllocationModel(env: Env): LanguageModel {
  const { provider, modelId } = active(env);
  if (provider === "virtuals") {
    const virtuals = createOpenAICompatible({
      name: "virtuals",
      baseURL: VIRTUALS_BASE_URL,
      apiKey: env.VIRTUALS_API_KEY,
    });
    return virtuals(modelId);
  }
  if (provider === "venice") {
    const venice = createOpenAICompatible({
      name: "venice",
      baseURL: VENICE_BASE_URL,
      apiKey: env.VENICE_API_KEY,
    });
    return venice(modelId);
  }
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic(modelId);
}
