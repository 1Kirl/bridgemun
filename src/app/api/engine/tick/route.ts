import { HttpError, withErrors } from "@/server/auth";

/**
 * Scheduler callback for the QStash driver — DELIBERATELY DISABLED.
 * It will be enabled together with QStash request-signature verification and a real QStash
 * connection (deployment step). Until then it refuses every call so nobody can drive forums from
 * outside. Local development uses the in-process scheduler plus the member "nudge" fallback.
 */
export const POST = withErrors(async () => {
  throw new HttpError(404, "not_enabled");
});
