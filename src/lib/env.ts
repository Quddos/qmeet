import { z } from "zod";

// Validated once at startup. Server-only values must never be imported into client components.
const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("https://qmeet.diaspafra.org"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  STUDENT_PIN_PEPPER: z.string().min(32).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}

// Reports which integrations are configured, without revealing any values.
export function integrationStatus(env: ServerEnv) {
  return {
    supabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseAdmin: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    livekit: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
    redis: Boolean(env.REDIS_URL),
    sessions: Boolean(env.SESSION_SECRET),
    studentPins: Boolean(env.STUDENT_PIN_PEPPER),
  };
}
