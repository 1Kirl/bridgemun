"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  addDoc, 
  collection, 
  serverTimestamp 
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/common/Header";
import { Footer } from "@/components/common/Footer";
import { Hero } from "@/components/landing/Hero";
import { ForumSection } from "@/components/landing/ForumSection";
import { LoginModal } from "@/components/landing/LoginModal";
import { RegisterModal } from "@/components/landing/RegisterModal";
import { ForumRegistrationModal } from "@/components/landing/ForumRegistrationModal";
import { CreateForumModal } from "@/components/landing/CreateForumModal";

export default function Home() {
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [forumModal, setForumModal] = useState<{ isOpen: boolean; title?: string }>({ isOpen: false });
  const [createForumOpen, setCreateForumOpen] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  const openLogin = () => {
    setRegisterModalOpen(false);
    setLoginModalOpen(true);
  };

  const openRegister = () => {
    setLoginModalOpen(false);
    setRegisterModalOpen(true);
  };

  const openForumRegistration = (title: string) => {
    setForumModal({ isOpen: true, title });
  };

  const openCreateForum = () => {
    setCreateForumOpen(true);
  };

  const handleCreateForum = async (data: any) => {
    try {
      const docRef = await addDoc(collection(db, "forums"), {
        ...data,
        createdBy: user?.uid ?? null,
        createdAt: serverTimestamp(),
        status: "active",
      });
      console.log("Forum created with ID:", docRef.id);
      setCreateForumOpen(false);
      router.push(`/forum/${docRef.id}`);
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header onLoginClick={openLogin} />
      <main className="flex-1 pt-16">
        <Hero 
          onLoginClick={openLogin} 
          onCreateForum={openCreateForum} 
        />
        <ForumSection onRequireLogin={openLogin} />
      </main>
      <Footer />
      
      {/* Modals */}
      <LoginModal 
        isOpen={loginModalOpen} 
        onClose={() => setLoginModalOpen(false)} 
        onSwitchToRegister={openRegister}
      />
      
      <RegisterModal 
        isOpen={registerModalOpen} 
        onClose={() => setRegisterModalOpen(false)} 
        onSwitchToLogin={openLogin}
      />

      <ForumRegistrationModal 
        isOpen={forumModal.isOpen} 
        onClose={() => setForumModal({ ...forumModal, isOpen: false })} 
        forumTitle={forumModal.title}
      />

      <CreateForumModal 
        isOpen={createForumOpen} 
        onClose={() => setCreateForumOpen(false)} 
        onSubmit={handleCreateForum} 
      />
    </div>
  );
}
