// One model per job, routed through OpenRouter. Override any of them with env vars.
export type Job = "code" | "writing" | "fast" | "factcheck" | "image" | "motion" | "video" | "look";

// Defaults checked against the OpenRouter catalogue on 2026-11-22.
const DEFAULTS: Record<Job, string> = {
  code: "anthropic/claude-sonnet-5.5",
  writing: "anthropic/claude-opus-5.5", // voice-preserving edits need the most careful model
  fast: "deepseek/deepseek-v4.1-flash", // titles, slugs, excerpts
  factcheck: "anthropic/claude-sonnet-5.5:online", // ":online" = web search plugin
  image: "google/gemini-3.1-flash-image", // POST /api/v1/images
  motion: "anthropic/claude-sonnet-5.5", // writes Remotion compositions
  look: "anthropic/claude-sonnet-5.5", // reads an image or animation and extracts its style (needs vision)
  video: "google/veo-3.1-fast", // AI video clips (POST /api/v1/videos); list: GET /api/v1/videos/models
};

export function modelFor(job: Job): string {
  return process.env[`MODEL_${job.toUpperCase()}`] || DEFAULTS[job];
}
