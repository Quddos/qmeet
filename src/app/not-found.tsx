import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link href="/" className="font-semibold text-[var(--brand)]">Back to QMeet</Link>
    </main>
  );
}
