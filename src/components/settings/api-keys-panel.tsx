"use client";

import { useT } from "@/components/i18n";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { API_PERMISSIONS, type ApiPermission } from "@/lib/api-keys";
import {
  createDeveloperKey,
  deleteDeveloperKey,
  generateApiKey,
  updateDeveloperKey,
} from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> API Key and Developer Keys (0101),
 * cloned from the client's reference, and live: they open the read-only
 * public API at /api/public/v1/<property>/.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE REFERENCE: a key is shown in full ONCE,
 * when it is made, and afterwards only as a hint. Only its hash is stored, so
 * nothing -- not this screen, not the database -- can show it again. A lost
 * key is replaced.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

export type DeveloperKey = {
  id: string;
  name: string;
  hint: string;
  permissions: ApiPermission[];
  isActive: boolean;
};

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const keyBox =
  "flex min-h-[2.25rem] items-center justify-between gap-3 rounded border border-line bg-shell px-3 py-1.5 font-mono text-[12px] text-ink";

function CopyButton({ text }: { text: string }) {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={tr("Copy")}
      className="shrink-0 font-sans text-[12px] text-brass hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? tr("Copied") : tr("Copy")}
    </button>
  );
}

/** A key just made: in full, with Copy, and the one clause saying it will not come back. */
function NewKey({ value }: { value: string }) {
  const tr = useT();
  return (
    <div className="space-y-1">
      <div className={cn(keyBox, "border-brass/50 bg-white")}>
        <span className="break-all">{value}</span>
        <CopyButton text={value} />
      </div>
      <p className="text-[11.5px] text-warn-deep">{tr("Copy it now — it will not be shown again.")}</p>
    </div>
  );
}

export function ApiKeyPanel({
  hint,
  canEdit,
  pending,
  run,
}: {
  hint: string | null;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [fresh, setFresh] = useState<string | null>(null);

  return (
    <div className="max-w-6xl space-y-4">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">{tr("Create API Key")}</h2>
      <section className={cn(card, "px-4 py-6 sm:px-6")}>
        {fresh ? (
          <NewKey value={fresh} />
        ) : hint ? (
          <div className={keyBox}>
            <span className="w-full text-center">{hint}</span>
          </div>
        ) : (
          <p className="text-center text-[13px] text-ink-muted">{tr("None yet. Generate one to use the API.")}</p>
        )}
      </section>
      {canEdit && (
        <section className={cn(card, "flex justify-end px-4 py-4 sm:px-6")}>
          <button
            type="button"
            className={primary}
            disabled={pending}
            onClick={() => {
              if (hint && !confirm(tr("Replace the API key? The current one stops working at once."))) return;
              run(async () => {
                const result = await generateApiKey();
                if (result.ok) setFresh(result.data.key);
                return result;
              }, tr("API key generated."));
            }}
          >
            {tr("Generate API key")}
          </button>
        </section>
      )}
    </div>
  );
}

export function DeveloperKeysPanel({
  propertyId,
  keys,
  canEdit,
  pending,
  run,
}: {
  propertyId: string;
  keys: DeveloperKey[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [origin, setOrigin] = useState("");
  // Read after mount: the browser's origin would differ between the two renders.
  useEffect(() => setOrigin(window.location.origin), []);

  function update(k: DeveloperKey, patch: Partial<DeveloperKey>) {
    const next = { ...k, ...patch };
    run(
      () => updateDeveloperKey({ id: next.id, name: next.name, permissions: next.permissions, isActive: next.isActive }),
      tr("{name} saved.", { name: k.name }),
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">{tr("Manage developers keys")}</h2>
      <section className={cn(card, "px-4 py-5 sm:px-6")}>
        <p className="text-center text-[13px] text-ink">
          {tr("Endpoint:")}{" "}
          <span className="break-all font-semibold">{origin ? tr("{origin}/api/public/v1/{propertyId}/", { origin: origin, propertyId: propertyId }) : ""}</span>
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-2 text-center font-semibold text-ink">{tr("Dev Key Name")}</th>
                <th className="px-2 py-2 text-center font-semibold text-ink">{tr("Permissions")}</th>
                <th className="px-2 py-2 text-center font-semibold text-ink">{tr("Is Active")}</th>
                <th className="w-10" aria-label={tr("Delete")} />
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-2 text-center text-[12px] text-ink">
                    {tr("No dev keys available. Create first")}
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="border-b border-line">
                    <td className="px-2 py-2 text-center text-ink">
                      {k.name}
                      <span className="ml-2 font-mono text-[11px] text-ink-muted">{k.hint}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                        {API_PERMISSIONS.map((p) => (
                          <label key={p.id} className="flex items-center gap-1 font-mono text-[11.5px] text-ink">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-brass"
                              checked={k.permissions.includes(p.id)}
                              onChange={(e) =>
                                canEdit &&
                                update(k, {
                                  permissions: e.target.checked
                                    ? [...k.permissions, p.id]
                                    : k.permissions.filter((x) => x !== p.id),
                                })
                              }
                            />
                            {p.path}
                          </label>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={tr("{name} is active", { name: k.name })}
                        className="h-4 w-4 accent-brass"
                        checked={k.isActive}
                        onChange={(e) => canEdit && update(k, { isActive: e.target.checked })}
                      />
                    </td>
                    <td className="py-1 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={tr("Delete {name}", { name: k.name })}
                          className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell"
                          onClick={() => {
                            if (!confirm(tr("Delete {name}? Anything using it stops working at once.", { name: k.name }))) return;
                            run(() => deleteDeveloperKey(k.id), tr("{name} deleted.", { name: k.name }));
                          }}
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
                            strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {fresh && (
          <div className="mt-4 space-y-1">
            <p className="text-[12px] text-ink">{fresh.name}</p>
            <NewKey value={fresh.key} />
          </div>
        )}
      </section>

      {canEdit && (
        <form
          className={cn(card, "px-4 py-5 sm:px-6")}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            run(async () => {
              const result = await createDeveloperKey(
                n,
                API_PERMISSIONS.map((p) => p.id),
              );
              if (result.ok) {
                setFresh({ name: n, key: result.data.key });
                setName("");
              }
              return result;
            }, `${n || "Developer key"} added.`);
          }}
        >
          <input
            aria-label={tr("New Dev Key name")}
            placeholder={tr("New Dev Key name")}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-brass"
          />
          <button type="submit" className={cn(primary, "mt-4")} disabled={pending}>
            {tr("Add")}
          </button>
        </form>
      )}
    </div>
  );
}
