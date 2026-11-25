import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card = ({ children, className }: CardProps) => {
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-shadow ${className}`}>
      {children}
    </div>
  );
};

export const CardHeader = ({ children, className }: CardProps) => (
  <div className={`mb-4 ${className}`}>{children}</div>
);

export const CardContent = ({ children, className }: CardProps) => (
  <div className={`space-y-4 ${className}`}>{children}</div>
);

export const CardFooter = ({ children, className }: CardProps) => (
  <div className={`mt-6 ${className}`}>{children}</div>
);
