// Deterministic guardrails for Vera's chat. Three pure, single-source, ~0ms
// helpers that need no model call:
//   - isInjection(text)      → a narrow prefilter for blatant role-override /
//                              jailbreak / prompt-extraction / "no JSON" attacks
//   - neutralizeUntrusted    → defuse replayed history so a prior turn can't
//                              masquerade as a system instruction
//   - CANNED_REFUSAL         → the in-voice scope decline the prefilter returns
//
// The REAL scope enforcement is the closed TurnSchema + the STEP-0 rule in the
// system prompt (veraRouter.ts); this only hardens the two things a prompt
// cannot fully defend — blatant injection and conversation-history poisoning.
//
// PATTERNS ARE INJECTION-SPECIFIC, NEVER FINANCE-TOPICAL. A false positive
// refuses a real investor, so nothing here matches finance words: "is NVDA
// risky?", "is my profit guaranteed?", "should I buy AAPL?" must all pass.

/** Role-override / jailbreak / prompt-extraction / transport-attack signatures.
 *  Deliberately narrow. Order doesn't matter — `isInjection` is an OR. */
export const INJECTION_PATTERNS: RegExp[] = [
  // "ignore / disregard / forget (your|previous|the above) instructions|rules|prompt"
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(instructions|rules|prompt|guidelines|directions|context)\b/i,
  // role / identity swap
  /\byou\s+are\s+now\s+(a|an|)\b/i,
  /\byou\s+are\s+no\s+longer\s+(vera|a\s+broker)\b/i,
  /\b(act|behave|respond|reply|talk|pretend)\s+(as|to\s+be|like)\s+(if\s+you\s+are\s+|a\s+|an\s+|not\s+)?(dan|an?\s+unrestricted|a\s+general|jailbroken|another|someone)/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  // developer / debug / god / jailbreak modes
  /\b(developer|debug|dev|god|admin|sudo|root|jailbreak|uncensored)\s*mode\b/i,
  /\bdan\b\s*mode\b|\bdo\s+anything\s+now\b/i,
  /\b(uncensored|jailbroken|no\s+restrictions|without\s+restrictions|no\s+rules|bypass\s+your)\b/i,
  // system-prompt extraction
  /\b(reveal|show|print|repeat|output|leak|tell\s+me|what\s+(are|were|is))\b[^.]{0,30}\b(system\s+prompt|your\s+instructions|the\s+prompt|the\s+text\s+above|these\s+rules|hidden\s+(context|rules|prompt))\b/i,
  /\brepeat\s+(everything|all|the\s+text)\s+(above|before)\b/i,
  // fake new system/developer directive
  /\bnew\s+(instructions?|task|system\s+prompt|role|persona)\s*[:=]/i,
  /^\s*(system|developer)\s*[:>]/i,
  // transport attack: "reply in plain text / no JSON / parser is broken"
  /\b(no|without|don'?t\s+(use|reply\s+in|output|return))\s+json\b/i,
  /\b(plain[- ]?text|prose)\s+only\b/i,
];

export function isInjection(text: string): boolean {
  if (!text) return false;
  return INJECTION_PATTERNS.some((r) => r.test(text));
}

/** Defuse a replayed history / context line so a prior user turn (or a poisoned
 *  holding name) can't masquerade as a system/assistant instruction: strip
 *  leading role tokens and role-ish tags, prefixing an inert marker. */
export function neutralizeUntrusted(line: string): string {
  return line
    .replace(/<\/?\s*(system|assistant|instructions?|developer|prompt)\s*>/gi, "")
    .replace(/^\s*(system|assistant|vera|developer|user|ai)\s*[:>]\s*/i, "· ");
}

/** Fixed, in-voice scope decline. Returned by the deterministic input prefilter
 *  so a blatant injection never reaches the model and its text is never echoed. */
export const CANNED_REFUSAL =
  "That's outside my lane — I'm your Monvera broker, not a general assistant. I can pull a live quote, build you a plan, or check your portfolio. Which one?";
