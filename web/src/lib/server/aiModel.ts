import "server-only";

// Inference provider for Vera's allocation model.
//
// Primary: Virtuals compute (compute.virtuals.io) — the Virtuals Protocol
// builder inference credits, claimed by the registered Vera agent. It is
// OpenAI-compatible (/v1/chat/completions, Bearer auth) and serves frontier
// models (incl. Claude), so the Vercel AI SDK reaches it through the
// openai-compatible provider with no change to our zod/structured-output code.
// Live model list: GET https://compute.virtuals.io/v1/models (source of truth).
//
// Fallbacks, in order: Venice AI (same OpenAI-compatible shape), then the
// direct Anthropic API. resolveModelChain() exposes every CONFIGURED provider
// in that order so callers can fail over at runtime (chat does); a provider
// only participates when its API key env is set.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

const VIRTUALS_BASE_URL = process.env.VIRTUALS_BASE_URL || "https://compute.virtuals.io/v1";
// Virtuals model id (from /v1/models). Claude by default so behaviour matches
// the Anthropic path our prompts were tuned on.
const VIRTUALS_MODEL = process.env.VIRTUALS_MODEL || "anthropic-claude-opus-4-8";

const VENICE_BASE_URL = process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1";
const VENICE_MODEL = process.env.VENICE_MODEL || "claude-opus-4-7";
const ANTHROPIC_MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

export type AiProvider = "virtuals" | "venice" | "anthropic";

/** Which provider + model id will serve the next allocation, based on env. */
function active(): { provider: AiProvider; modelId: string } {
  if (process.env.VIRTUALS_API_KEY) return { provider: "virtuals", modelId: VIRTUALS_MODEL };
  if (process.env.VENICE_API_KEY) return { provider: "venice", modelId: VENICE_MODEL };
  return { provider: "anthropic", modelId: ANTHROPIC_MODEL };
}

/** The model id that will actually serve the next allocation (for display/telemetry). */
export function activeModelId(): string {
  return active().modelId;
}

/** True when at least one inference provider is configured. */
export function hasAiProvider(): boolean {
  return Boolean(
    process.env.VIRTUALS_API_KEY || process.env.VENICE_API_KEY || process.env.ANTHROPIC_API_KEY,
  );
}

function buildModel(provider: AiProvider): LanguageModel {
  if (provider === "virtuals") {
    const virtuals = createOpenAICompatible({
      name: "virtuals",
      baseURL: VIRTUALS_BASE_URL,
      apiKey: process.env.VIRTUALS_API_KEY,
    });
    return virtuals(VIRTUALS_MODEL);
  }
  if (provider === "venice") {
    const venice = createOpenAICompatible({
      name: "venice",
      baseURL: VENICE_BASE_URL,
      apiKey: process.env.VENICE_API_KEY,
    });
    return venice(VENICE_MODEL);
  }
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(ANTHROPIC_MODEL);
}

/** Build the language model for an allocation call (Virtuals > Venice > Anthropic). */
export function resolveAllocationModel(): LanguageModel {
  return buildModel(active().provider);
}

/** Every CONFIGURED provider's model, in precedence order — the real failover
 *  chain. Callers try each in turn so a Virtuals outage degrades to Venice or
 *  Anthropic instead of failing the user's turn. (One key set = chain of one.) */
export function resolveModelChain(): { provider: AiProvider; model: LanguageModel }[] {
  const chain: { provider: AiProvider; model: LanguageModel }[] = [];
  if (process.env.VIRTUALS_API_KEY) chain.push({ provider: "virtuals", model: buildModel("virtuals") });
  if (process.env.VENICE_API_KEY) chain.push({ provider: "venice", model: buildModel("venice") });
  if (process.env.ANTHROPIC_API_KEY) chain.push({ provider: "anthropic", model: buildModel("anthropic") });
  if (!chain.length) chain.push({ provider: "anthropic", model: buildModel("anthropic") });
  return chain;
}
