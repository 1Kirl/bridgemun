import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: React.ReactNode;
}

export const Input = ({ label, icon, className, ...props }: InputProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-gray-700">{label}</label>
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-4 text-gray-400">
            {icon}
          </div>
        )}
        <input
          className={`w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 ${icon ? "pl-11" : "px-4"} pr-4 text-sm font-medium transition-all focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand/5 ${className}`}
          {...props}
        />
      </div>
    </div>
  );
};
