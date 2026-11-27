"use client";

import React from "react";
import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/brand/Logo";

interface HeaderProps {
  onLoginClick: () => void;
}

export const Header = ({ onLoginClick }: HeaderProps) => {
  const { user, logout } = useAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between border-b border-gray-100 bg-white/80 px-6 backdrop-blur-md">
      <Link
        href="/"
        className="rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#1580d8]/30"
        aria-label="BridgeMUN home"
      >
        <Logo />
      </Link>
      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-3">
            <Link
              href="/me"
              className="text-sm font-bold text-[#0088cc] hover:underline"
            >
              My forums
            </Link>
            <Link
              href="/me/profile"
              className="flex max-w-[200px] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-200 hover:bg-gray-50"
            >
              <User size={16} className="shrink-0 text-gray-400" />
              <span className="truncate">
                {user.displayName || user.email}
              </span>
            </Link>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut size={14} className="mr-1" />
              Log Out
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={onLoginClick}>
            Log In
          </Button>
        )}
      </div>
    </header>
  );
};
