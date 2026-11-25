"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { Database, LayoutDashboard, Globe, Shield, Lock, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  
  // Custom Admin Session
  const [isAuthorized, setIsAuthorized] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("admin_auth") === "true";
    }
    return false;
  });
  const [adminId, setAdminId] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [error, setError] = useState("");

  const handleAdminAuth = (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = process.env.NEXT_PUBLIC_ADMIN_ID || "admin";
    const targetPw = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "1234";

    if (adminId === targetId && adminPw === targetPw) {
      setIsAuthorized(true);
      sessionStorage.setItem("admin_auth", "true");
      setError("");
    } else {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  if (!isAuthorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc] p-6">
        <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 text-brand shadow-sm mb-6 ring-1 ring-brand/10">
              <Shield size={32} />
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Admin Portal</h1>
            <p className="mt-2 text-sm text-gray-400 font-bold uppercase tracking-widest leading-none">Authorization Required</p>
          </div>

          <form onSubmit={handleAdminAuth} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-2xl shadow-brand/5 space-y-5">
            <div className="space-y-4">
              <Input
                label="Admin ID"
                placeholder="어드민 아이디 입력"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                placeholder="비밀번호 입력"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-[10px] font-black text-red-500 uppercase tracking-widest text-center animate-bounce">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full py-6 rounded-2xl bg-brand text-white hover:bg-brand-hover shadow-xl shadow-brand/20 gap-2">
              <span className="font-black">Access Admin Area</span>
              <ArrowRight size={18} strokeWidth={3} />
            </Button>
          </form>
          
          <div className="text-center">
             <Link href="/" className="text-xs font-bold text-gray-400 hover:text-brand transition-colors">
                ← Return to Landing Page
             </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-gray-400 font-black tracking-widest animate-pulse">AUTHENTICATING...</div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-white p-8 text-center gap-4">
        <div className="h-12 w-12 rounded-full border-4 border-brand border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-black text-gray-900 tracking-tight">Waiting for Firebase Auth...</p>
        <p className="text-xs text-gray-400 font-bold uppercase leading-none">Please make sure you are logged in</p>
      </div>
    );
  }

  const navItems = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "Forums", href: "/admin/forums", icon: Database },
    { label: "Countries", href: "/admin/countries", icon: Globe },
  ];

  return (
    <div className="flex h-screen bg-[#f8fafc]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <Shield className="text-brand mr-2" size={24} />
          <h1 className="font-black text-gray-900 tracking-tight text-xl">MUN Admin</h1>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${
                  isActive 
                    ? "bg-brand/10 text-brand shadow-sm ring-1 ring-brand/10" 
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-gray-200 flex items-center px-8">
          <span className="text-sm font-semibold text-gray-500">
            Admin: <span className="text-gray-900">{user.displayName || user.email}</span>
          </span>
          <Link href="/" className="ml-auto text-xs font-bold text-brand hover:underline">
            Back to App
          </Link>
        </header>
        <div className="flex-1 p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
