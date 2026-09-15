"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-shell px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xxs font-semibold uppercase tracking-[0.18em] text-brass">
            Hotel Operations
          </p>
          <h1 className="mt-3 font-display text-[28px] font-semibold tracking-tightest text-ink">
            The Grand Hotel
          </h1>
          <p className="mt-2 text-[13px] text-ink-muted">
            Sign in to your property management system
          </p>
        </div>

        <section className="rounded-lg border border-line bg-white p-6 shadow-card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-ink"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-ink"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>

        <p className="mt-5 text-center text-xxs text-ink-faint">
          Secure property access
        </p>
      </div>
    </main>
  );
}
