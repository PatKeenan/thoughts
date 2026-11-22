import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { lookToPrompt, validateLook } from "@/lib/look";
import { MAX_VIDEO_BYTES, ndjsonStream, putMedia, putMediaStream } from "@/lib/media";
import { modelFor } from "@/lib/models";
import {
  HttpError,
  errorResponse,
  jsonError,
  pollVideo,
  readJson,
  submitVideo,
  videoContent,
  videoModelInfo,
} from "@/lib/openrouter";
import type { Aspect } from "@/lib/types";

export const maxDuration = 300;

const ASPECTS: Aspect[] = ["16:9", "1:1", "4:5", "3:2"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 6000;
const DEADLINE_MS = 270_000; // leave headroom under maxDuration for download + store

const ratio = (a: string) => {
  const [w, h] = a.split(":").map(Number);
  return w / h;
};

/** Closest supported aspect ratio (by ratio value); the requested one when nothing is known. */
function pickAspect(want: string, supported: string[]): string {
  if (!supported.length || supported.includes(want)) return want;
  const r = ratio(want);
  return [...supported].filter((a) => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(a)).sort((a, b) => Math.abs(ratio(a) - r) - Math.abs(ratio(b) - r))[0] ?? want;
}

function pickDuration(want: number, supported: number[]): number {
  if (!supported.length) return want;
  return [...supported].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
}

function dims(aspect: string): { width: number; height: number } {
  const r = ratio(aspect);
  const height = 720;
  return { width: Math.round((height * r) / 2) * 2, height };
}

let mockMp4: Promise<Buffer> | null = null;
function makeMockMp4(): Promise<Buffer> {
  mockMp4 ??= new Promise<Buffer>((resolve, reject) => {
    const out = path.join(tmpdir(), `mock-${randomUUID()}.mp4`);
    execFile(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x180:rate=15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
      { timeout: 30_000 },
      async (err) => {
        if (err) return reject(new Error("Mock video needs ffmpeg installed"));
        try {
          resolve(await readFile(out));
        } catch (e) {
          reject(e);
        } finally {
          rm(out, { force: true }).catch(() => {});
        }
      },
    );
  }).catch((e) => {
    mockMp4 = null;
    throw e;
  });
  return mockMp4;
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson(request);
    const userPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
    if (!userPrompt) return jsonError(400, "prompt is required");
    // An invalid look is ignored. The look description is appended to what the model gets.
    const look = body.look ? validateLook(body.look) : null;
    const prompt = look ? `${userPrompt}\n\nVisual style to match (style only, not subject matter):\n${lookToPrompt(look)}` : userPrompt;
    const aspect = body.aspect as Aspect;
    if (!ASPECTS.includes(aspect)) return jsonError(400, "aspect must be one of 16:9, 1:1, 4:5, 3:2");
    const seconds = Math.min(30, Math.max(1, Math.round(Number(body.seconds) || 5)));
    const signal = request.signal;

    if (process.env.AI_MOCK === "1") {
      return ndjsonStream(async (emit) => {
        const mp4 = makeMockMp4();
        mp4.catch(() => {}); // surfaced below; avoid an unhandled rejection while sleeping
        const steps = ["Queued", "Generating", "Generating", "Finishing"];
        for (let i = 0; i < steps.length; i++) {
          if (signal.aborted) return;
          emit({ type: "progress", label: steps[i], progress: (i + 1) / (steps.length + 1) });
          await sleep(300);
        }
        const bytes = await mp4;
        const { url } = await putMedia(bytes, "video/mp4");
        emit({ type: "done", url, width: 320, height: 180 });
      });
    }

    // Fail fast (JSON error, proper status) before opening the stream when the key is missing.
    if (!process.env.OPENROUTER_API_KEY) throw new HttpError(500, "OPENROUTER_API_KEY is not set");

    return ndjsonStream(async (emit) => {
      emit({ type: "progress", label: "Submitting", progress: 0.02 });
      const model = modelFor("video");
      const info = await videoModelInfo(model, signal);
      const useAspect = pickAspect(aspect, info?.aspects ?? []);
      const duration = pickDuration(seconds, info?.durations ?? []);
      const resolution = info?.resolutions.includes("720p") ? "720p" : undefined;

      let job = await submitVideo({ prompt, aspect_ratio: useAspect, duration, ...(resolution ? { resolution } : {}), generate_audio: false }, signal);
      const started = Date.now();
      emit({ type: "progress", label: "Queued", progress: 0.05 });

      while (job.status !== "completed") {
        if (["failed", "cancelled", "expired"].includes(job.status)) {
          throw new Error(job.error || `Video generation ${job.status}`);
        }
        if (signal.aborted) return;
        const elapsed = Date.now() - started;
        if (elapsed > DEADLINE_MS) throw new Error("Video generation is taking too long, try a shorter clip");
        await sleep(POLL_MS);
        job = await pollVideo(job, signal);
        // The API reports no percentage: ease towards 85% over ~3 minutes.
        const p = 0.05 + 0.8 * (1 - Math.exp(-(Date.now() - started) / 90_000));
        emit({ type: "progress", label: job.status === "in_progress" ? "Generating" : "Waiting in queue", progress: Math.min(0.85, p) });
      }

      emit({ type: "progress", label: "Downloading", progress: 0.9 });
      let res: Response;
      const direct = job.unsignedUrls[0];
      if (direct && /^https:\/\//.test(direct) && !direct.startsWith("https://openrouter.ai/api/")) {
        res = await fetch(direct, { signal });
        if (!res.ok) res = await videoContent(job, signal);
      } else {
        res = await videoContent(job, signal);
      }
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_VIDEO_BYTES) throw new Error("The video is larger than 200 MB");
      if (!res.body) throw new Error("The video download was empty");
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      const { url } = await putMediaStream(res.body, type === "video/webm" ? "video/webm" : "video/mp4", MAX_VIDEO_BYTES);
      emit({ type: "done", url, ...dims(useAspect) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
