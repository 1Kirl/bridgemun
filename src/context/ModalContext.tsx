"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AlertCircle, HelpCircle } from "lucide-react";

type DialogType = "alert" | "confirm";

interface DialogOptions {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type: DialogType;
  resolve: (value: any) => void;
}

interface ModalContextType {
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
}

const ModalContext = createContext<ModalContextType | null>(null);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  const showAlert = useCallback((message: string, title: string = "Notice") => {
    return new Promise<void>((resolve) => {
      setDialog({
        message,
        title,
        type: "alert",
        confirmText: "OK",
        resolve,
      });
    });
  }, []);

  const showConfirm = useCallback((message: string, title: string = "Confirmation") => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        message,
        title,
        type: "confirm",
        confirmText: "Confirm",
        cancelText: "Cancel",
        resolve,
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    if (!dialog) return;
    const { resolve, type } = dialog;
    setDialog(null);
    resolve(type === "confirm" ? false : undefined);
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    if (!dialog) return;
    const { resolve, type } = dialog;
    setDialog(null);
    resolve(type === "confirm" ? true : undefined);
  }, [dialog]);

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      {dialog && (
        <Modal 
          isOpen={true} 
          onClose={handleClose} 
          title={dialog.title}
        >
          <div className="flex flex-col gap-8">
            <div className="flex gap-5">
              <div className={`shrink-0 flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ${
                dialog.type === "confirm" 
                  ? "bg-brand/10 text-brand" 
                  : "bg-amber-50 text-amber-600"
              }`}>
                {dialog.type === "confirm" ? (
                  <HelpCircle size={28} strokeWidth={2.5} />
                ) : (
                  <AlertCircle size={28} strokeWidth={2.5} />
                )}
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-[17px] font-semibold leading-relaxed text-slate-700">
                  {dialog.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-2">
              {dialog.type === "confirm" && (
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  className="px-6 h-11 border-gray-200 text-gray-500 font-bold text-[11px] uppercase tracking-[0.1em] hover:bg-gray-50"
                >
                  {dialog.cancelText}
                </Button>
              )}
              <Button 
                onClick={handleConfirm}
                className={`px-8 h-11 font-bold text-[11px] uppercase tracking-[0.15em] shadow-xl transition-all hover:-translate-y-0.5 active:translate-y-0 ${
                  dialog.type === "confirm" 
                    ? "bg-brand hover:shadow-brand/20" 
                    : "bg-amber-600 hover:bg-amber-700 hover:shadow-amber-600/20"
                }`}
              >
                {dialog.confirmText}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return context;
}
