import OpenAI from "openai";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export const SENTIMENT_LABELS = [
  "Extremely Negative",
  "Very Negative",
  "Negative",
  "Neutral",
  "Positive",
  "Very Positive",
  "Extremely Positive"
] as const;

export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

export interface SentimentResult {
  label: SentimentLabel;
  rationale: string;
  confidence: number | null;
  source: "openai" | "heuristic";
}

const openAiClient = env.OPENAI_API_KEY
  ? new OpenAI({
    apiKey: env.OPENAI_API_KEY
  })
  : null;

export async function analyzeFinancialSentiment(text: string): Promise<SentimentResult> {
  if (text.trim().length === 0) {
    return {
      label: "Neutral",
      rationale: "Post had no textual content to evaluate.",
      confidence: null,
      source: "heuristic"
    };
  }

  if (openAiClient) {
    try {
      const completion = await openAiClient.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a senior financial markets analyst specializing in geopolitical event analysis and market impact assessment.

Your task: Analyze social media posts (particularly from influential political figures) and assess their potential SHORT-TERM impact on U.S. equity markets, specifically the S&P 500 (SPX).

SENTIMENT CLASSIFICATION:
Use ONLY these labels:
- Extremely Positive: Major positive catalyst, likely to drive significant market rally
- Very Positive: Strong positive news, clear upward pressure on markets
- Positive: Moderately good news, likely modest market gains
- Neutral: No significant market impact expected
- Negative: Moderately concerning, likely modest market decline
- Very Negative: Serious concern, clear downward pressure on markets
- Extremely Negative: Major crisis/shock, likely to drive significant market selloff

ANALYSIS FRAMEWORK:
Consider these factors:
1. Geopolitical stability/instability and conflict resolution
2. Policy announcements affecting major sectors (tech, defense, energy, finance)
3. Trade relationships and tariff implications
4. Regulatory changes or signals
5. Market uncertainty vs. clarity
6. Institutional investor sentiment drivers
7. Global economic stability indicators

MARKET IMPACT REASONING:
- Conflict resolution/peace → Reduces uncertainty → Bullish
- Trade deals/cooperation → Economic growth → Bullish
- Tariffs/trade tensions → Economic headwinds → Bearish
- Regulatory clarity → Reduces uncertainty → Generally Bullish
- Military escalation → Risk-off sentiment → Bearish
- Major policy shifts → Volatility (direction depends on specifics)

OUTPUT FORMAT:
Return a JSON object with:
{
  "sentimentLabel": "one of the 7 permitted labels",
  "rationale": "2-3 sentence explanation focusing on WHY this impacts markets and WHICH market mechanisms/sectors are affected. Mention specific market drivers like uncertainty reduction, sector beneficiaries, or risk sentiment.",
  "confidence": 0.85
}

CRITICAL RULES:
- Focus on MARKET IMPACT, not political opinions
- Be specific about market mechanisms (e.g., "reduces geopolitical risk premium," "increases defense sector outlook")
- Consider institutional investor behavior
- Assess short-term (days to weeks) market reaction
- Confidence should reflect clarity and magnitude of market impact

EXAMPLES:
Post: "Major peace agreement signed ending regional conflict"
→ Extremely Positive: Significant reduction in geopolitical uncertainty, risk-on sentiment, broad market rally expected

Post: "Considering new tariffs on electronics imports"
→ Negative: Supply chain concerns, tech sector pressure, modest market headwind

Post: "Happy Thanksgiving to all Americans"
→ Neutral: No market impact expected

Post: "Vaccines are bad!"
→ Neutral: No market impact expected

Post: "The NBA sucks!"
→ Neutral: No market impact expected`
          },
          {
            role: "user",
            content: text
          }
        ]
      });

      const rawContent = completion.choices[0]?.message?.content;
      if (rawContent) {
        const parsed = JSON.parse(rawContent) as {
          sentimentLabel?: string;
          rationale?: string;
          confidence?: number;
        };
        if (parsed.sentimentLabel && isSentimentLabel(parsed.sentimentLabel)) {
          return {
            label: parsed.sentimentLabel,
            rationale:
              parsed.rationale?.trim() ?? "Model did not provide a detailed rationale.",
            confidence:
              typeof parsed.confidence === "number"
                ? Math.min(Math.max(parsed.confidence, 0), 1)
                : null,
            source: "openai"
          };
        }
      }
      logger.warn("OpenAI response could not be parsed, falling back to heuristic.", {
        rawContent
      });
    } catch (error) {
      logger.error("OpenAI sentiment analysis failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return heuristicSentiment(text);
}

function isSentimentLabel(value: string): value is SentimentLabel {
  return (SENTIMENT_LABELS as readonly string[]).includes(value);
}

function heuristicSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  const positiveKeywords = ["bullish", "record high", "growth", "strong", "positive"];
  const negativeKeywords = ["crisis", "sanction", "tariff", "downturn", "recession", "bearish"];

  let score = 0;
  for (const keyword of positiveKeywords) {
    if (lower.includes(keyword)) {
      score += 1;
    }
  }
  for (const keyword of negativeKeywords) {
    if (lower.includes(keyword)) {
      score -= 1;
    }
  }

  let label: SentimentLabel = "Neutral";
  if (score <= -3) {
    label = "Extremely Negative";
  } else if (score === -2) {
    label = "Very Negative";
  } else if (score === -1) {
    label = "Negative";
  } else if (score === 1) {
    label = "Positive";
  } else if (score === 2) {
    label = "Very Positive";
  } else if (score >= 3) {
    label = "Extremely Positive";
  }

  return {
    label,
    rationale:
      "Heuristic fallback used keyword spotting to estimate directional market impact.",
    confidence: null,
    source: "heuristic"
  };
}
