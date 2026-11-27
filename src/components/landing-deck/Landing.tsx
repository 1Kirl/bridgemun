"use client";

/*
 * Landing page ported from the reference landing (Willahn12/bridgemun: app/page.tsx, app/layout.tsx header/intro,
 * components/Deck, PlacardStage, SpeechStudio, Intro, SiteHeader). Layout, palette, typography, scenes and
 * animations are kept; texts and buttons are adapted to what BridgeMUN actually offers, and every action goes to
 * an existing flow (log in / sign up / create forum / join with a code / my forums).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Brain, Gavel, Handshake, Microphone, Scroll, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";
import { CreateForumModal } from "@/components/landing/CreateForumModal";
import { JoinForumModal } from "@/components/landing/JoinForumModal";
import { Logo } from "@/components/brand/Logo";
import Deck from "./Deck";
import Intro from "./Intro";
import PlacardStage from "./PlacardStage";
import SiteHeader from "./SiteHeader";
import SpeechStudio from "./SpeechStudio";

const FLOW_COLORS = ["var(--cyan)", "var(--sun)", "var(--coral)", "var(--mint)"];

/* What the site does, in plain words — only features that exist today. */
const ICON = { size: 30, weight: "fill", color: "#0c2b4b", "aria-hidden": true } as const;
const FEATURES = [
  { title: "Open a committee", text: "Pick a committee, an agenda and the countries. Share a six-character code; classmates join and choose a seat.", color: "var(--cyan)", icon: <UsersThree {...ICON} /> },
  { title: "Debate AI delegations", text: "Empty seats are filled by AI delegations that speak, move motions, vote and sign drafts for their own country.", color: "var(--sun)", icon: <Handshake {...ICON} /> },
  { title: "An automatic chair", text: "Roll call, speakers’ list, motions, caucuses and votes follow HMUN-style rules, with the same step and deadline for everyone.", color: "var(--coral)", icon: <Gavel {...ICON} /> },
  { title: "Speak in your own voice", text: "Speak through your microphone (your speech is transcribed for the record) or type it. Audio and video run in the room.", color: "var(--mint)", icon: <Microphone {...ICON} /> },
  { title: "Draft resolutions", text: "Write working papers and draft resolutions, collect sponsors and signatories, amend clauses and vote on the final text.", color: "var(--sky)", icon: <Scroll {...ICON} /> },
  { title: "See why the AI acted", text: "Every AI speech, motion and vote comes with a short reason and the research it drew on, so you can check it.", color: "var(--sun)", icon: <Brain {...ICON} /> },
];

type Act = "create" | "join" | "forums" | "login";

/* Who says what in a session. Each part of the room speaks for itself, like a delegate. */
const VOICES: Array<{ who: string; initial: string; color: string; side: "left" | "right"; text: string; act: Act; cta: string }> = [
  { who: "The automatic chair", initial: "C", color: "var(--sun)", side: "left", text: "Delegates, the roll call is open. Then the speakers’ list, motions and caucuses — I keep the time and apply the rules for everyone.", act: "create", cta: "Open a committee" },
  { who: "An AI delegation", initial: "A", color: "var(--cyan)", side: "right", text: "I represent my country from its researched positions. I will speak, move motions and vote — and explain why.", act: "join", cta: "Join with a code" },
  { who: "You", initial: "Y", color: "var(--mint)", side: "left", text: "I take the floor with my microphone or in writing, sign drafts, and vote. When the session ends, the record and results stay in My forums.", act: "forums", cta: "See my forums" },
];

const at = (n: number) => ({ "--i": n }) as React.CSSProperties;

const CHIPS = [
  { text: "Committees with classmates", color: "var(--cyan)" },
  { text: "AI delegations that research their country", color: "var(--sun)" },
  { text: "An automatic chair", color: "var(--mint)" },
  { text: "Live audio and video", color: "var(--coral)" },
];

const LABELS = ["Welcome", "What it does", "Try it", "How it works", "Practice", "The steps", "Get started"];
const DARK = [false, false, false, false, false, false, true];
const FX = ["zoom", "up", "side", "up", "zoom", "side", "zoom"];

export function Landing() {
  const { user, logout } = useAuth();
  const [modal, setModal] = useState<null | "login" | "register" | "create" | "join">(null);
  const signedIn = !!user;

  // Client-side navigation to "/" does not run the inline script: make sure the motion flag is set anyway.
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.motion) return;
    let off = false;
    try {
      off = localStorage.getItem("bridgemun.motion") === "off";
    } catch {}
    if (!off && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) root.dataset.motion = "full";
  }, []);

  const act = (a: Act) => {
    if (a === "forums") return; // handled by a Link
    if (!signedIn) return setModal("login");
    setModal(a === "join" ? "join" : "create");
  };

  const FLOW = [
    { verb: "Create", text: "Open a committee: title, agenda, countries and your own seat. AI delegations fill the rest.", act: "create" as Act },
    { verb: "Invite", text: "Share the six-character code. Classmates join, choose a country and wait in the lobby.", act: "join" as Act },
    { verb: "Debate", text: "Roll call, speeches, motions and caucuses, run by the automatic chair under HMUN-style rules.", act: "create" as Act },
    { verb: "Vote", text: "Introduce draft resolutions, amend them and vote. The results and the full record stay in My forums.", act: "forums" as Act },
  ];

  const slides = [
    /* 1. The cover */
    <div key="cover" className="relative flex min-h-full flex-col overflow-hidden bg-[radial-gradient(60rem_40rem_at_50%_42%,#ffffff,var(--sky)_92%)]">
      <span data-pop style={at(0)} aria-hidden="true" className="absolute left-[8%] top-[12%] aspect-square w-44 rounded-full bg-[var(--sun)]" />
      <span data-pop style={at(1)} aria-hidden="true" className="absolute right-[10%] top-[20%] aspect-square w-28 rounded-full bg-[var(--cyan)]" />
      <span data-pop style={at(2)} aria-hidden="true" className="absolute bottom-[18%] left-[14%] aspect-square w-24 rounded-full bg-[var(--coral)]" />
      <span data-pop style={at(3)} aria-hidden="true" className="absolute bottom-[14%] right-[12%] aspect-square w-40 rounded-full bg-[var(--mint)]" />
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
        <h1 data-anim="zoom" style={at(0)} className="font-display text-6xl font-extrabold tracking-tight sm:text-8xl lg:text-9xl" translate="no">
          BridgeMUN
        </h1>
        <p data-anim="flip" style={at(1)} className="mt-5 font-display text-3xl font-bold sm:text-5xl">
          Making Model UN possible for everyone around the globe.
        </p>
        <p data-anim="up" style={at(2)} className="mt-7 max-w-[58ch] text-xl leading-relaxed text-muted sm:text-2xl">
          BridgeMUN runs Model UN committees online. Classmates and AI delegations debate, negotiate and vote under an automatic chair.
        </p>
        <ul data-anim="drop" style={at(3)} className="mt-10 flex flex-wrap justify-center gap-3">
          {CHIPS.map((c) => (
            <li key={c.text} className="rounded-full border-2 border-ink px-5 py-2 text-base font-bold text-ink" style={{ background: c.color }}>
              {c.text}
            </li>
          ))}
        </ul>
        <p data-anim="blur" style={at(4)} className="mt-10 text-base text-muted">
          Built for students new to Model UN — and for classes that want to practise together.
        </p>
      </div>
    </div>,

    /* 2. What the site does */
    <div key="does" className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <h2 data-anim="left" style={at(0)} className="max-w-[20ch] text-4xl font-extrabold md:text-6xl">
          What BridgeMUN does
        </h2>
        <p data-anim="right" style={at(1)} className="mt-4 max-w-[52ch] text-lg leading-relaxed text-muted">
          A full committee needs many delegates and a chair. BridgeMUN brings both, so a small group can hold a real session any time.
        </p>
        <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <li key={f.title} data-anim={["left", "flip", "right"][i % 3]} style={at(i + 2)} className="flex gap-4">
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl border-2 border-ink" style={{ background: f.color }}>
                {f.icon}
              </span>
              <div>
                <h3 className="font-display text-xl font-bold">{f.title}</h3>
                <p className="mt-1 leading-relaxed text-muted">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>,

    /* 3. The placard */
    <div key="try" className="mx-auto grid min-h-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div data-anim="left" style={at(0)}>
        <h2 className="text-5xl font-extrabold leading-[0.98] md:text-6xl lg:text-7xl">Making Model UN possible for everyone around the globe.</h2>
        <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-muted">
          Open a committee in a minute, invite classmates with a code, and let AI delegations take the remaining seats.
        </p>
      </div>
      <div data-anim="right" style={at(1)}>
        <PlacardStage signedIn={signedIn} onCreate={() => act("create")} onJoin={() => act("join")} />
      </div>
    </div>,

    /* 4. The conversation */
    <div key="talk" className="flex min-h-full flex-col bg-sunk">
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <h2 data-anim="drop" style={at(0)} className="max-w-[14ch] text-4xl font-extrabold md:text-6xl">
          What happens when you sit down
        </h2>
        <ul className="space-y-4">
          {VOICES.map((v, n) => {
            const right = v.side === "right";
            return (
              <li key={v.who} data-anim={right ? "right" : "left"} style={at(n + 1)} className={`flex items-end gap-3 ${right ? "flex-row-reverse lg:ml-12" : "lg:mr-12"}`}>
                <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-ink font-display text-lg font-extrabold text-ink" style={{ background: v.color }}>
                  {v.initial}
                </span>
                <div className={`max-w-[34rem] border-2 border-ink p-4 text-ink sm:p-5 ${right ? "bubble-right bg-[var(--sky)] shadow-[5px_5px_0_var(--sun)]" : "bubble-left bg-surface shadow-[5px_5px_0_var(--cyan)]"}`}>
                  <p className="text-sm font-bold text-accent">{v.who}</p>
                  <p className="mt-1 leading-relaxed">{v.text}</p>
                  {v.act === "forums" ? (
                    <Link href={signedIn ? "/me" : "/"} onClick={(e) => { if (!signedIn) { e.preventDefault(); setModal("login"); } }} className="group mt-2 inline-flex items-center gap-2 font-bold text-accent">
                      {v.cta}
                      <ArrowRight aria-hidden="true" size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
                    </Link>
                  ) : (
                    <button type="button" onClick={() => act(v.act)} className="group mt-2 inline-flex items-center gap-2 font-bold text-accent">
                      {v.cta}
                      <ArrowRight aria-hidden="true" size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,

    /* 5. Practice box (browser dictation + read-aloud, right here on the page) */
    <div key="speech" className="mx-auto grid min-h-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
      <div data-anim="blur" style={at(0)}>
        <h2 className="text-4xl font-extrabold md:text-6xl">Say it out loud before you say it in the room</h2>
        <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-muted">
          Try your opening speech here: dictate it, then hear it read back. In a committee you speak through your microphone or type your speech.
        </p>
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Microphone aria-hidden="true" size={16} /> This practice box uses your browser’s own dictation and voice (Chrome, Edge, Safari). Nothing is saved.
        </p>
      </div>
      <div data-anim="flip" style={at(1)}>
        <SpeechStudio rows={7} />
      </div>
    </div>,

    /* 6. The steps */
    <div key="steps" className="flex min-h-full flex-col bg-sunk">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <h2 data-anim="blur" style={at(0)} className="max-w-[22ch] text-4xl font-extrabold md:text-6xl">
          From a code to the floor of the committee
        </h2>
        <ol className="relative mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          <span aria-hidden="true" className="absolute left-0 right-0 top-[17px] hidden h-1.5 rounded-full bg-[var(--sky)] lg:block" />
          {FLOW.map((f, i) => {
            const inner = (
              <>
                <span aria-hidden="true" className="relative z-10 grid size-9 place-items-center rounded-full border-[3px] border-ink text-sm font-extrabold text-ink transition-transform duration-200 group-hover:scale-125" style={{ background: FLOW_COLORS[i] }}>
                  {i + 1}
                </span>
                <span className="mt-4 flex items-center gap-2 font-display text-2xl font-bold group-hover:text-accent">
                  {f.verb}
                  <ArrowRight aria-hidden="true" size={20} weight="bold" className="-translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="mt-2 block max-w-[30ch] text-left leading-relaxed text-muted">{f.text}</span>
              </>
            );
            return (
              <li key={f.verb} data-anim="drop" style={at(i + 1)}>
                {f.act === "forums" && signedIn ? (
                  <Link href="/me" className="group block rounded-[var(--radius-ui)] outline-offset-8">{inner}</Link>
                ) : (
                  <button type="button" onClick={() => act(f.act === "forums" ? "create" : f.act)} className="group block rounded-[var(--radius-ui)] text-left outline-offset-8">
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>,

    /* 7. Take the floor */
    <div key="go" className="flex min-h-full flex-col bg-[linear-gradient(160deg,#3a8fd9,#1d63ab)] text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
        <h2 data-anim="zoom" style={at(0)} className="text-5xl font-extrabold leading-[1] md:text-7xl">
          Ready to take the floor?
        </h2>
        <p data-anim="blur" style={at(1)} className="mt-5 max-w-[44ch] text-lg leading-relaxed text-white/90">
          {signedIn ? "Open a committee for your class, or join one with the code you were given." : "Log in or create an account, then open a committee or join one with a code."}
        </p>
        <div data-anim="flip" style={at(2)} className="mt-8 flex flex-wrap justify-center gap-3">
          {signedIn ? (
            <>
              <button type="button" onClick={() => setModal("create")} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-accent shadow-[0_4px_0_rgb(12_43_75_/_0.35)] transition-transform hover:-translate-y-0.5" data-testid="landing-create">
                Create a committee
                <ArrowRight aria-hidden="true" size={18} weight="bold" />
              </button>
              <button type="button" onClick={() => setModal("join")} className="inline-flex items-center gap-2 rounded-full border-2 border-white px-6 py-3 font-bold transition-colors hover:bg-white/15" data-testid="landing-join">
                Join with a code
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setModal("login")} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-accent shadow-[0_4px_0_rgb(12_43_75_/_0.35)] transition-transform hover:-translate-y-0.5">
                Log in to start
                <ArrowRight aria-hidden="true" size={18} weight="bold" />
              </button>
              <button type="button" onClick={() => setModal("register")} className="inline-flex items-center gap-2 rounded-full border-2 border-white px-6 py-3 font-bold transition-colors hover:bg-white/15">
                Create an account
              </button>
            </>
          )}
        </div>
        <p data-anim="up" style={at(3)} className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-medium text-white/85">
          {signedIn ? (
            <>
              <Link href="/me" className="hover:underline">My forums</Link>
              <Link href="/me/profile" className="hover:underline">Profile</Link>
            </>
          ) : (
            <button type="button" onClick={() => setModal("login")} className="hover:underline">Sign in</button>
          )}
        </p>
        <p data-anim="up" style={at(4)} className="mt-8 text-sm text-white/75">
          <span translate="no">BridgeMUN</span> · Model UN with classmates and AI delegations.
        </p>
      </div>
    </div>,
  ];

  return (
    <>
      <Intro />
      <a href="#main" className="sr-only rounded-[var(--radius-ui)] bg-accent px-4 py-2 font-medium text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50">
        Skip to main content
      </a>
      <SiteHeader>
        <div className="flex h-16 items-center gap-3 px-4 sm:gap-6 sm:px-8 lg:px-12">
          <Link href="/" data-header-logo aria-label="BridgeMUN home" className="flex shrink-0 items-center">
            <Logo />
          </Link>
          <nav aria-label="Main" className="ml-auto flex items-center gap-2 text-sm font-semibold sm:gap-3" data-testid="landing-nav">
            {signedIn ? (
              <>
                <Link href="/me" className="hidden rounded-full px-3 py-1.5 text-ink hover:bg-sunk sm:inline-block">My forums</Link>
                <button type="button" onClick={() => setModal("join")} className="btn hidden sm:inline-flex">Join forum</button>
                <button type="button" onClick={() => setModal("create")} className="btn btn-primary">Create forum</button>
                <Link href="/me/profile" className="hidden max-w-[10rem] truncate px-2 text-muted hover:text-ink md:inline">{user?.displayName || user?.email}</Link>
                <button type="button" onClick={() => void logout()} className="whitespace-nowrap px-2 text-muted hover:text-ink">Log out</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setModal("login")} className="btn">Log in</button>
                <button type="button" onClick={() => setModal("register")} className="btn btn-primary">Sign up</button>
              </>
            )}
          </nav>
        </div>
      </SiteHeader>
      <main id="main" tabIndex={-1} className="outline-none">
        <Deck slides={slides} labels={LABELS} dark={DARK} fx={FX} />
      </main>
      <LoginModal isOpen={modal === "login"} onClose={() => setModal(null)} onSwitchToRegister={() => setModal("register")} />
      <RegisterModal isOpen={modal === "register"} onClose={() => setModal(null)} onSwitchToLogin={() => setModal("login")} />
      <CreateForumModal isOpen={modal === "create"} onClose={() => setModal(null)} />
      <JoinForumModal isOpen={modal === "join"} onClose={() => setModal(null)} />
    </>
  );
}
