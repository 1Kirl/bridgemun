import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/server/firebaseAdmin";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type AuthedUser = { uid: string; name?: string; email?: string };

/** Verifies the Firebase ID token sent as `Authorization: Bearer <token>`. */
export async function requireUser(req: NextRequest | Request): Promise<AuthedUser> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new HttpError(401, "unauthenticated", "Missing bearer token");
  try {
    const decoded = await adminAuth().verifyIdToken(match[1], true);
    return { uid: decoded.uid, name: decoded.name as string | undefined, email: decoded.email };
  } catch {
    throw new HttpError(401, "unauthenticated", "Invalid or expired token");
  }
}

/** Wraps a route handler: maps HttpError to JSON, hides internal errors. */
export function withErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      }
      console.error("[api] unexpected error", e);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  };
}
