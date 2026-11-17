export const dynamic = "force-dynamic";

import Link from "next/link";
import { integrationStatus, readEnv } from "@/lib/env";

export default function Home() {
  const status = integrationStatus(readEnv());
  const videoReady = status.livekit;

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-10 px-4 py-16 sm:px-6">
      <header className="flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-[var(--brand)]">QMeet</span>
        <Link href="/staff/login" className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold">
          Staff sign in
        </Link>
      </header>

      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Virtual classes for up to 400 students</h1>
        <p className="max-w-2xl text-[var(--muted)]">
          Teachers run the lecture, students join with their registration number and the meeting PIN, and attendance and quiz results are recorded automatically.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/join" className="rounded-full bg-[var(--brand)] px-5 py-3 font-semibold text-[var(--brand-ink)]">
            Student: join a class
          </Link>
        </div>
      </section>

      {!videoReady && (
        <p role="status" className="rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          Live video is not connected yet. The media server has not been configured for this deployment, so meetings cannot start.
        </p>
      )}
    </main>
  );
}
