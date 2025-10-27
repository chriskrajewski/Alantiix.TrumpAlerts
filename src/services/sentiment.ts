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
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a senior financial markets analyst. Score posts based on expected short-term impact on U.S. financial markets. " +
              "Only use the permitted sentiment labels: Extremely Negative, Very Negative, Negative, Neutral, Positive, Very Positive, Extremely Positive. " +
              "Return a JSON object with keys: sentimentLabel (string), rationale (string, <= 3 sentences), confidence (number 0-1)."
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
