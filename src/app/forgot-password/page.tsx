"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    // Built here rather than during render, for the same reason the sign-in
    // page does it: this page is prerendered, and creating the client up there
    // makes the build depend on the Supabase environment variables.
    const supabase = createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    // Anything left is a real failure — the address is malformed, or too many
    // have been asked for too quickly. Supabase does not say whether an email
    // belongs to an account, and neither does the message below, because a
    // sign-in page that answers that question answers it for anyone who asks.
    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-shell px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xxs font-semibold uppercase tracking-[0.18em] text-brass">
            Hotel Operations
          </p>
          <h1 className="mt-3 font-display text-[28px] font-semibold tracking-tightest text-ink">
            Reset your password
          </h1>
          <p className="mt-2 text-[13px] text-ink-muted">
            We will email you a link to set a new one
          </p>
        </div>

        <section className="rounded-lg border border-line bg-white p-6 shadow-card">
          {sent ? (
            <div className="space-y-4">
              <div
                role="status"
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-800"
              >
                If {email.trim()} belongs to a staff account, a link to set a
                new password is on its way. It expires in an hour, and it only
                works once.
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                Nothing arrived? Check the spam folder, then try again. If the
                address was wrong, an administrator can tell you which one the
                account uses.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-md border border-line px-4 py-2.5 text-center text-sm font-medium text-ink-muted transition hover:bg-shell hover:text-ink"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
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
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20"
                  placeholder="you@example.com"
                />
                <p className="mt-1.5 text-xxs leading-relaxed text-ink-faint">
                  The address your staff account was set up with.
                </p>
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
                {loading ? "Sending…" : "Send the link"}
              </button>

              <Link
                href="/login"
                className="block text-center text-xs text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </section>

        <p className="mt-5 text-center text-xxs text-ink-faint">
          Secure property access
        </p>
      </div>
    </main>
  );
}
