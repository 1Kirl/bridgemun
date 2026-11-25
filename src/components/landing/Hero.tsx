'use client';

import React from "react";
import { KeyRound, LogIn, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";

interface HeroProps {
  onLoginClick: () => void;
  onCreateForum: () => void;
  onJoinForum: () => void;
}

export const Hero = ({ onLoginClick, onCreateForum, onJoinForum }: HeroProps) => {
  const { user } = useAuth();

  return (
    <section className="relative flex flex-col items-center justify-center bg-gradient-to-b from-[#f1f7ff] to-white px-6 pb-20 pt-32 text-center">
      <div className="max-w-4xl space-y-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
          Participate in Model UN Forums
        </h1>
        <div className="mx-auto max-w-2xl space-y-6">
          <p className="text-lg text-gray-600 sm:text-xl md:text-2xl">
            Create a committee, share its code, and debate with other students and
            AI delegations under an automatic chair that follows HMUN-style rules.
          </p>
          <p className="text-base text-gray-400">
            Speakers&apos; list, motions, caucuses and votes are run by the server, so
            everyone sees the same step and the same deadline.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 pt-4 sm:flex-row">
          {user ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="flex items-center gap-2 px-10 py-7 transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-brand/20"
                onClick={onCreateForum}
              >
                <Plus size={22} />
                <span className="text-lg font-bold">Create Forum</span>
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="flex items-center gap-2 px-10 py-7 transition-all hover:scale-[1.02] active:scale-95"
                onClick={onJoinForum}
              >
                <KeyRound size={22} />
                <span className="text-lg font-bold">Join Forum</span>
              </Button>
            </>
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
