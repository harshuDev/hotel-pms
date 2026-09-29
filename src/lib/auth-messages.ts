import { msg } from "@/lib/i18n/translate";
import type { Translator } from "@/lib/i18n/translate";

/*
 * What Supabase Auth says on the sign-in, forgot and reset screens, as keys
 * the staff dictionaries translate. Auth answers in English whatever the
 * reader chose; tr.message() matches these exactly, or by pattern where Auth
 * puts a number in ("after 42 seconds"). A message not listed shows as Auth
 * wrote it.
 */
msg("Invalid login credentials");
msg("Email not confirmed");
msg("Email rate limit exceeded");
msg("email rate limit exceeded");
msg("For security purposes, you can only request this after {0} seconds.");
msg("New password should be different from the old password.");
msg("Password should be at least 6 characters.");
msg("Unable to validate email address: invalid format");
msg("Email link is invalid or has expired");
msg("Token has expired or is invalid");
msg("Auth session missing!");

/**
 * An Auth error as the reader should see it. The one case that needs more
 * than a translation: a reset link that came back as a PKCE code and was
 * opened in a different browser from the one that asked, where Auth's own
 * words ("code verifier not found in storage") say nothing a receptionist
 * can act on.
 */
export function authErrorText(
  tr: Translator,
  error: { name?: string; message: string },
): string {
  if (error.name === "AuthPKCECodeVerifierMissingError" || /code verifier/i.test(error.message)) {
    return tr("This link has to be opened in the browser that asked for it. Open it there, or ask for a new link here.");
  }
  return tr.message(error.message);
}
