"use client";

import { useState } from "react";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Hero } from "@/components/landing/Hero";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";
import { CreateForumModal } from "@/components/landing/CreateForumModal";
import { JoinForumModal } from "@/components/landing/JoinForumModal";

export default function Home() {
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const openLogin = () => {
    setRegisterModalOpen(false);
    setLoginModalOpen(true);
  };
  const openRegister = () => {
    setLoginModalOpen(false);
    setRegisterModalOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header onLoginClick={openLogin} />
      <main className="flex-1 pt-16">
        <Hero onLoginClick={openLogin} onCreateForum={() => setCreateOpen(true)} onJoinForum={() => setJoinOpen(true)} />
      </main>
      <Footer />
      <LoginModal isOpen={loginModalOpen} onClose={() => setLoginModalOpen(false)} onSwitchToRegister={openRegister} />
      <RegisterModal isOpen={registerModalOpen} onClose={() => setRegisterModalOpen(false)} onSwitchToLogin={openLogin} />
      <CreateForumModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
      <JoinForumModal isOpen={joinOpen} onClose={() => setJoinOpen(false)} />
    </div>
  );
}
