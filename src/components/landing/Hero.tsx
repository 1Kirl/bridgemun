'use client';

import React from "react";
import { LogIn, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";

interface HeroProps {
  onLoginClick: () => void;
  onCreateForum: () => void;
}

export const Hero = ({ onLoginClick, onCreateForum }: HeroProps) => {
  const { user } = useAuth();

  return (
    <section className="relative flex flex-col items-center justify-center bg-gradient-to-b from-[#f1f7ff] to-white px-6 pb-20 pt-32 text-center">
      <div className="max-w-4xl space-y-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
          Participate in Model UN Forums
        </h1>
        <div className="mx-auto max-w-2xl space-y-6">
          <p className="text-lg text-gray-600 sm:text-xl md:text-2xl">
            Join live diplomatic simulations via Zoom. Represent countries, debate
            global issues, and vote on resolutions in real-time.
          </p>
          <p className="text-base text-gray-400">
            Platform features text-based discussion logs, speaker queue
            management, and AI-powered analysis for comprehensive session
            reporting.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center pt-4">
          {user ? (
            <Button
              variant="primary"
              size="lg"
              className="flex items-center gap-2 px-12 py-7 transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-brand/20"
              onClick={onCreateForum}
            >
              <Plus size={22} />
              <span className="text-lg font-bold">Create New Forum</span>
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="flex items-center gap-2 px-12 py-7 transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-brand/20"
              onClick={onLoginClick}
            >
              <LogIn size={22} />
              <span className="text-lg font-bold">Start Your Session (Login)</span>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
};
