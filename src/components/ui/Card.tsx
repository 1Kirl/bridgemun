import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card = ({ children, className }: CardProps) => {
  return (
    <div className={`bm-card bm-tone-sky rounded-xl p-6 ${className}`}>
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
