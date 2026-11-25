import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type SpeakRequest = {
  id: string;
  userId: string;
  userName: string;
  status: 'pending' | 'approved' | 'done' | 'rejected';
  createdAt: any;
};

export type Speech = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  sourceType?: 'human' | 'ai';
  country?: {
    name: string;
    code: string;
  };
  createdAt: any;
  editedAt?: any;
};

export function useSpeakQueue(forumId: string) {
  const [requests, setRequests] = useState<SpeakRequest[]>([]);
  const [speeches, setSpeeches] = useState<Speech[]>([]);

  useEffect(() => {
    if (!forumId) return;
    const q = query(
      collection(db, 'forums', forumId, 'speakRequests'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, 
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SpeakRequest)));
      },
      (err) => {
        console.error("Firestore speakRequests error:", err);
      }
    );
  }, [forumId]);

  useEffect(() => {
    if (!forumId) return;
    const q = query(
      collection(db, 'forums', forumId, 'speeches'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, 
      (snap) => {
        setSpeeches(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Speech)));
      },
      (err) => {
        console.error("Firestore speeches error:", err);
      }
    );
  }, [forumId]);

  const requestToSpeak = async (userId: string, userName: string) => {
    try {
      const active = requests.find(
        (r) => r.userId === userId && (r.status === 'pending' || r.status === 'approved'),
      );
      if (active) return;
      await addDoc(collection(db, 'forums', forumId, 'speakRequests'), {
        userId,
        userName,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error in requestToSpeak:", err);
    }
  };

  const approveRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'forums', forumId, 'speakRequests', requestId), {
        status: 'approved',
      });
    } catch (err) {
      console.error("Error in approveRequest:", err);
    }
  };

  const rejectRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, 'forums', forumId, 'speakRequests', requestId), {
        status: 'rejected',
      });
    } catch (err) {
      console.error("Error in rejectRequest:", err);
    }
  };

  const submitSpeech = async (
    requestId: string,
    userId: string,
    userName: string,
    text: string,
    country?: { name: string; code: string },
  ) => {
    try {
      await updateDoc(doc(db, 'forums', forumId, 'speakRequests', requestId), { status: 'done' });
      if (text.trim()) {
        await addDoc(collection(db, 'forums', forumId, 'speeches'), {
          userId,
          userName,
          text: text.trim(),
          ...(country ? { country } : {}),
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error("Error in submitSpeech:", err);
    }
  };

  const updateSpeech = async (speechId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await updateDoc(doc(db, 'forums', forumId, 'speeches', speechId), {
      text: trimmed,
      editedAt: serverTimestamp(),
    });
  };

  return {
    requests,
    speeches,
    requestToSpeak,
    approveRequest,
    rejectRequest,
    submitSpeech,
    updateSpeech,
  };
}
