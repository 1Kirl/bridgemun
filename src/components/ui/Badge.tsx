import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline";
  className?: string;
}

export const Badge = ({ children, variant = "primary", className }: BadgeProps) => {
  const variants = {
    primary: "bg-brand-light text-brand font-bold uppercase tracking-wider",
    secondary: "bg-gray-100 text-gray-600 font-medium",
    outline: "border border-gray-200 text-gray-600 font-medium",
  };

  return (
    <span className={`inline-block rounded px-2.5 py-1 text-[10px] ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};
