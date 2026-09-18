"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** The shortest password Supabase will accept by default. */
const MIN_LENGTH = 8;

type Stage =
  | { name: "checking" }
  | { name: "ready" }
  | { name: "invalid"; reason: string };

export default function ResetPasswordPage() {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>({ name: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * Turn whatever the email link carried into a session.
   *
   * Which shape arrives depends on the project's auth flow and email template,
   * and this page is the same page either way, so it handles all three rather
   * than assuming one:
   *
   *   ?code=...                    PKCE
   *   ?token_hash=...&type=recovery   the current email template
   *   #access_token=...            the older implicit flow, which the browser
   *                                client picks up by itself on load
   *
   * The URL is read from window rather than useSearchParams because the last
   * of those lives in the fragment, which never reaches the server and so is
   * not in useSearchParams at all.
   */
  useEffect(() => {
    let cancelled = false;

    async function establishSession() {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");

      // An error can come back on the link itself — expired, already used.
      const linkError =
        url.searchParams.get("error_description") ??
        new URLSearchParams(url.hash.slice(1)).get("error_description");

      if (linkError) {
        if (!cancelled) setStage({ name: "invalid", reason: linkError });
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          setStage(
            error ? { name: "invalid", reason: error.message } : { name: "ready" },
          );
        }
        return;
      }

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });
        if (!cancelled) {
          setStage(
            error ? { name: "invalid", reason: error.message } : { name: "ready" },
          );
        }
        return;
      }

      // Nothing in the URL. Either the implicit flow already turned the
      // fragment into a session, or somebody typed the address in.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setStage(
        data.session
          ? { name: "ready" }
          : {
              name: "invalid",
              reason:
                "This page needs the link from the reset email. Ask for a new one below.",
            },
      );
    }

    void establishSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < MIN_LENGTH) {
      setError(`A password needs at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    // updateUser leaves the recovery session signed in, so this lands on the
    // dashboard rather than back at sign-in. refresh() is what makes the
    // server components pick the new session up.
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
            Set a new password
          </h1>
          <p className="mt-2 text-[13px] text-ink-muted">
            You will be signed in once it is saved
          </p>
        </div>

        <section className="rounded-lg border border-line bg-white p-6 shadow-card">
          {stage.name === "checking" && (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              Checking the link…
            </p>
          )}

          {stage.name === "invalid" && (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-relaxed text-rose-700"
              >
                {stage.reason}
              </div>
              <p className="text-xs leading-relaxed text-ink-muted">
                Reset links expire after an hour and work only once, so an older
                email in the same thread will not do. Asking for a new one takes
                a moment.
              </p>
              <Link
                href="/forgot-password"
                className="block w-full rounded-md bg-ink px-4 py-2.5 text-center text-sm font-medium text-white transition hover:opacity-90"
              >
                Send a new link
              </Link>
            </div>
          )}

          {stage.name === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-medium text-ink"
                >
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20"
                  placeholder={`At least ${MIN_LENGTH} characters`}
                />
              </div>

              <div>
                <label
                  htmlFor="confirm"
                  className="mb-1.5 block text-xs font-medium text-ink"
                >
                  Again
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20"
                  placeholder="Type it once more"
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
                disabled={saving}
                className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save the password"}
              </button>
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
