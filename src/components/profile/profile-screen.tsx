"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { saveOwnProfile } from "@/lib/actions/profile";
import type { StaffRole } from "@/lib/types";

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  front_desk: "Front desk",
  cashier: "Cashier",
  housekeeping: "Housekeeping",
};

const ROLE_NOTE: Record<StaffRole, string> = {
  admin: "Everything, including staff and settings",
  manager: "Rates, settings, the night audit and the drawer total",
  front_desk: "Bookings, check-in and out, payments",
  cashier: "Payments and the drawer",
  housekeeping: "Room status, and no money at all",
};

/** Matches the reset screen, and stricter than GoTrue's own minimum of six. */
const MIN_LENGTH = 8;

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const card = "rounded-lg border border-line bg-white p-5 shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";

function Message({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "mt-4 rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
        ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
      )}
      role={ok ? "status" : "alert"}
    >
      {children}
    </p>
  );
}

export function ProfileScreen({
  fullName,
  role,
}: {
  fullName: string;
  role: StaffRole;
}) {
  const router = useRouter();

  const [name, setName] = useState(fullName);
  const [nameMessage, setNameMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, startSaveName] = useTransition();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  function submitName() {
    setNameMessage(null);
    startSaveName(async () => {
      const result = await saveOwnProfile({ fullName: name });
      if (!result.ok) {
        setNameMessage({ ok: false, text: result.error ?? "That did not work." });
        return;
      }
      setNameMessage({ ok: true, text: "Name saved." });
      router.refresh();
    });
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage(null);

    if (next.length < MIN_LENGTH) {
      setPasswordMessage({
        ok: false,
        text: `A password needs at least ${MIN_LENGTH} characters.`,
      });
      return;
    }
    if (next !== confirm) {
      setPasswordMessage({ ok: false, text: "The two new passwords do not match." });
      return;
    }
    if (next === current) {
      setPasswordMessage({ ok: false, text: "That is the password you already have." });
      return;
    }

    setSavingPassword(true);
    const supabase = createClient();

    // The current password is checked before the new one is set, which
    // updateUser on its own does not do — it trusts the session. A front desk
    // terminal is left unlocked more often than anybody admits, and without
    // this anyone walking past could lock the real user out of their own
    // account. Signing in again is the only way to verify it.
    const { data: session } = await supabase.auth.getUser();
    const email = session.user?.email;

    if (!email) {
      setSavingPassword(false);
      setPasswordMessage({
        ok: false,
        text: "Your session has expired. Sign in again and retry.",
      });
      return;
    }

    const { error: wrongPassword } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });

    if (wrongPassword) {
      setSavingPassword(false);
      setPasswordMessage({ ok: false, text: "That is not your current password." });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setSavingPassword(false);

    if (error) {
      setPasswordMessage({ ok: false, text: error.message });
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setPasswordMessage({ ok: true, text: "Password changed." });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className={card}>
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Your name
        </h2>

        <div>
          <label htmlFor="full-name" className={label}>Full name</label>
          <input
            id="full-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </div>

        <div className="mt-4 rounded-md bg-shell px-3 py-2.5">
          <p className={label}>Role</p>
          <p className="text-[13px] text-ink">{ROLE_LABEL[role]}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            {ROLE_NOTE[role]}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Only an administrator can change a role, and not their own. Ask one
            if this is wrong.
          </p>
        </div>

        <div className="mt-4">
          <button
            onClick={submitName}
            disabled={savingName || name.trim() === "" || name === fullName}
            className={primary}
          >
            {savingName ? "Saving…" : "Save the name"}
          </button>
        </div>

        {nameMessage && <Message ok={nameMessage.ok}>{nameMessage.text}</Message>}
      </div>

      <div className={card}>
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Your password
        </h2>

        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label htmlFor="current-password" className={label}>Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="new-password" className={label}>New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={`At least ${MIN_LENGTH} characters`}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className={label}>Again</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={field}
            />
          </div>

          <button type="submit" disabled={savingPassword} className={primary}>
            {savingPassword ? "Changing…" : "Change the password"}
          </button>
        </form>


        {passwordMessage && (
          <Message ok={passwordMessage.ok}>{passwordMessage.text}</Message>
        )}
      </div>
    </div>
  );
}
