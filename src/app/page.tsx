import { Figtree, Inter_Tight } from "next/font/google";
import { Landing } from "@/components/landing-deck/Landing";
import "@/components/landing-deck/landing.css";

/* Fonts of the reference landing; scoped to this page (Bricolage, used by the logo too, is loaded in the root layout). */
const heading = Inter_Tight({ variable: "--font-heading", subsets: ["latin"] });
const body = Figtree({ variable: "--font-body", subsets: ["latin"] });

/*
 * Runs before the first paint of a FULL page load only (React does not execute it on client-side navigation):
 * - motion: animations on unless the visitor turned them off on this page or the OS asks for reduced motion;
 * - intro: once per browser session, so coming back from a meeting room never replays it.
 */
const LANDING_INIT = `try{var r=document.documentElement,off=false;try{off=localStorage.getItem("bridgemun.motion")==="off"}catch(e){}var rm=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;if((!off&&!rm)||location.search.indexOf("motion=on")>-1)r.dataset.motion="full";var seen=false;try{seen=sessionStorage.getItem("bridgemun.intro")==="seen";sessionStorage.setItem("bridgemun.intro","seen")}catch(e){}if(!seen&&location.search.indexOf("intro=off")<0){r.dataset.intro="on";setTimeout(function(){delete r.dataset.intro},9000)}}catch(e){}`;

export default function Home() {
  return (
    <div className={`bm-landing ${heading.variable} ${body.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: LANDING_INIT }} />
      <Landing />
    </div>
  );
}
