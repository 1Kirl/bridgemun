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
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
  
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover shadow-sm",
    secondary: "bg-white text-brand border border-gray-200 hover:bg-gray-50 shadow-sm",
    outline: "border border-gray-300 bg-transparent hover:bg-gray-50",
    ghost: "hover:bg-gray-100 text-gray-700",
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
