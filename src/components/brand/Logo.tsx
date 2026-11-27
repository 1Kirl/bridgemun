/**
 * The one BridgeMUN logo used everywhere (landing, headers, auth dialogs, meeting room). Source files:
 * design/brand/*.svg (editable), public/brand/* (served), src/app/icon.svg + favicon.ico + apple-icon.png (browser).
 *
 * Symbol: two towers (delegations) joined by one cable; the gold point is where they meet. Towers + cable also read
 * as an "M" for MUN. Not derived from the UN emblem.
 */
type Tone = "light" | "dark";

export function LogoSymbol({ className = "h-8 w-8", inverse = false, title }: { className?: string; inverse?: boolean; title?: string }) {
  const tile = inverse ? "#ffffff" : "#1580d8";
  const line = inverse ? "#1580d8" : "#ffffff";
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="15" fill={tile} />
      <path d="M17 45V17M47 45V17" stroke={line} strokeWidth="5" strokeLinecap="round" />
      <path d="M17 22C23 35 41 35 47 22" fill="none" stroke={line} strokeWidth="4" strokeLinecap="round" />
      <path d="M8 45h48" stroke={line} strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="32" cy="31.8" r="5.2" fill="#f7c948" stroke={tile} strokeWidth="1.6" />
    </svg>
  );
}

/** Symbol + "BridgeMUN" wordmark. `tone` is the BACKGROUND it sits on. */
export function Logo({ tone = "light", size = "md", className = "", wordmark = true }: { tone?: Tone; size?: "sm" | "md" | "lg"; className?: string; wordmark?: boolean }) {
  const sym = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-11 w-11" : "h-8 w-8";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-3xl" : "text-xl";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} translate="no">
      <LogoSymbol className={sym} />
      {wordmark && (
        <span className={`font-bold tracking-tight ${text} ${tone === "dark" ? "text-white" : "text-[#0c2b4b]"}`} style={{ fontFamily: "var(--font-bric, inherit)" }}>
          Bridge<span className={tone === "dark" ? "text-[#7cc4ff]" : "text-[#1580d8]"}>MUN</span>
        </span>
      )}
    </span>
  );
}
