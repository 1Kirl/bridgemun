'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

type AuthContextType = {
  user: User | null;
  /** true until first onAuthStateChanged fires */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);

      // Firebase does not await async observers; keep callback sync and isolate async work.
      if (!user) return;
      void (async () => {
        try {
          const userRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(userRef);
          if (!docSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              displayName: user.displayName || 'Anonymous',
              email: user.email,
              updatedAt: serverTimestamp(),
            });
          } else {
            const data = docSnap.data();
            if (!data.displayName && user.displayName) {
              await setDoc(userRef, { displayName: user.displayName }, { merge: true });
            }
          }
        } catch (e) {
          console.error('Error ensuring user profile in Firestore:', e);
        }
      })();
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const register = async (name: string, email: string, password: string) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: name });
    
    // Save to Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      displayName: name,
      // store the address as Firebase Auth normalised it (lower case), not as typed
      email: user.email ?? email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
