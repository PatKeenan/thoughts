// One model per job, routed through OpenRouter. Override any of them with env vars.
export type Job = "code" | "writing" | "fast" | "factcheck" | "image" | "motion";

// Defaults checked against the OpenRouter catalogue on 2026-11-22.
const DEFAULTS: Record<Job, string> = {
  code: "anthropic/claude-sonnet-5.5",
  writing: "anthropic/claude-opus-5.5", // voice-preserving edits need the most careful model
  fast: "deepseek/deepseek-v4.1-flash", // titles, slugs, excerpts
  factcheck: "anthropic/claude-sonnet-5.5:online", // phase 2 (":online" = web search plugin)
  image: "google/gemini-3.1-flash-image", // phase 2 (POST /api/v1/images)
  motion: "anthropic/claude-sonnet-5.5", // phase 2
};

export function modelFor(job: Job): string {
  return process.env[`MODEL_${job.toUpperCase()}`] || DEFAULTS[job];
}
