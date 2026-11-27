import React from "react";
import { Logo } from "@/components/brand/Logo";

export const Footer = () => {
  return (
    <footer className="border-t border-gray-100 bg-white py-12 px-6">
      <div className="mx-auto max-w-7xl text-center">
        <Logo size="sm" className="mb-2" />
        <p className="text-sm font-medium text-gray-500">© 2026 BridgeMUN · Model UN with classmates and AI delegations</p>
      </div>
    </footer>
  );
};
