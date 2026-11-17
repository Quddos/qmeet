import { describe, expect, it } from "vitest";
import { integrationStatus, readEnv } from "@/lib/env";

describe("readEnv", () => {
  it("defaults the app URL to the production domain", () => {
    expect(readEnv({}).NEXT_PUBLIC_APP_URL).toBe("https://qmeet.diaspafra.org");
  });

  it("rejects a session secret that is too short", () => {
    expect(() => readEnv({ SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("reports integrations as unconfigured without exposing values", () => {
    const status = integrationStatus(readEnv({}));
    expect(status).toEqual({
      supabase: false,
      supabaseAdmin: false,
      livekit: false,
      redis: false,
      sessions: false,
      studentPins: false,
    });
  });

  it("marks LiveKit configured only when all three values exist", () => {
    const partial = integrationStatus(readEnv({ LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k" }));
    expect(partial.livekit).toBe(false);
    const full = integrationStatus(readEnv({ LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" }));
    expect(full.livekit).toBe(true);
  });
});
