import type { AmendmentOp, DocumentState, ForumEngineState } from "@/engine/types";

/** Deterministic 64-bit FNV-1a hash (hex). Runs identically on server and client. */
export function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function docTextHash(d: Pick<DocumentState, "title" | "preambular" | "operative">): string {
  return stableHash({ t: d.title, p: d.preambular, o: d.operative });
}

/** Smallest forum size the app allows (app policy) so that sponsor/signatory rules stay satisfiable. */
export const MIN_SEATS = 3;

/**
 * D9: thresholds are capped so they are always satisfiable with distinct delegations:
 *   sponsors ≤ members − 1, sponsors + signatories ≤ members, amendment proposer + signatories ≤ members.
 * With the defaults (2 sponsors, 20% signatories, 2 amendment signatories) no cap triggers from 3 seats up
 * except where the formula itself would exceed the room (tested for 3–60 seats).
 */
export function effectiveDocThresholds(members: number, s: ForumEngineState["settings"]["documents"]) {
  const sponsors = Math.max(1, Math.min(s.minSponsors, members - 1));
  const signatories = Math.max(0, Math.min(Math.ceil(s.minSignatoryRatio * members), members - sponsors));
  const amendmentSignatories = Math.max(0, Math.min(s.minAmendmentSignatories, members - 1));
  return { sponsors, signatories, amendmentSignatories };
}

/**
 * Stand-in for "approval of the Director" (rule 26) — APP POLICY:
 * minimum sponsors/signatories (rule 24 numbers are Director-set → forum settings),
 * minimum clause counts, not a duplicate, and under the resolution cap.
 */
export function evaluateApproval(state: ForumEngineState, doc: DocumentState): { approved: boolean; reasons: string[] } {
  const s = state.settings.documents;
  const reasons: string[] = [];
  if (doc.kind !== "draft_resolution") return { approved: false, reasons: ["working papers are not introduced"] };
  const members = Object.keys(state.seats).length;
  const eff = effectiveDocThresholds(members, s);
  const minSignatories = eff.signatories;
  if (doc.sponsors.length < eff.sponsors) reasons.push(`needs ${eff.sponsors} sponsors`);
  if (doc.signatories.length < minSignatories) reasons.push(`needs ${minSignatories} signatories`);
  if (doc.preambular.filter((x) => x.trim()).length < s.minPreambular) reasons.push(`needs ${s.minPreambular} preambular clause(s)`);
  if (doc.operative.filter((x) => x.trim()).length < s.minOperative) reasons.push(`needs ${s.minOperative} operative clauses`);
  const others = Object.values(state.documents).filter(
    (o) => o.id !== doc.id && o.kind === "draft_resolution" && (o.status === "approved" || o.status === "introduced" || o.status === "adopted"),
  );
  if (others.some((o) => o.textHash === doc.textHash)) reasons.push("duplicate of another resolution");
  if (doc.status !== "approved" && others.length >= s.maxResolutions) reasons.push(`committee limit of ${s.maxResolutions} resolutions reached`);
  return { approved: reasons.length === 0, reasons };
}

export function validateAmendmentOp(doc: DocumentState, op: AmendmentOp): string | null {
  const n = doc.operative.length;
  if (op.kind === "insert") {
    if (op.clauseIndex < 0 || op.clauseIndex > n) return "insert position out of range";
    if (!op.text?.trim()) return "insert text required";
    return null;
  }
  if (op.clauseIndex < 0 || op.clauseIndex >= n) return "clause index out of range";
  if (op.kind === "replace" && !op.text?.trim()) return "replacement text required";
  if (op.kind === "delete" && n <= 1) return "cannot delete the last operative clause";
  return null;
}

export function applyAmendmentOp(doc: DocumentState, op: AmendmentOp): string[] {
  const ops = [...doc.operative];
  if (op.kind === "replace") ops[op.clauseIndex] = op.text;
  else if (op.kind === "insert") ops.splice(op.clauseIndex, 0, op.text);
  else ops.splice(op.clauseIndex, 1);
  return ops;
}
