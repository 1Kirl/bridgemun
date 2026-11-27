import React from "react";
import { cn } from "@/lib/utils"; // Assuming I'll create a simple utils for classes or just use string concat if not

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export const Button = ({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) => {
  // BridgeMUN buttons (shared with the landing): pill shape, a small press shadow, short press feedback.
  // Disabled buttons are flat with no hover or press so they never look clickable. Sizes are unchanged.
  const baseStyles =
    "bm-btn inline-flex items-center justify-center rounded-full font-semibold [font-family:var(--font-heading),var(--font-body),system-ui,sans-serif] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-45";

  const variants = {
    primary: "bm-btn-primary bg-brand text-white",
    secondary: "bm-btn-secondary border border-[var(--bm-line)] bg-white text-brand hover:border-brand/50",
    outline: "border border-gray-300 bg-white text-gray-800 hover:border-gray-500",
    ghost: "text-gray-700 hover:bg-gray-100",
  };

  const sizes = {
    sm: "h-9 px-3 text-xs",
    md: "h-10 px-6 py-2 text-sm",
    lg: "h-12 px-8 text-base",
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
