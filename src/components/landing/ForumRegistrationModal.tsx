import React from "react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { ChevronDown } from "lucide-react";

interface ForumRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  forumTitle?: string;
}

export const ForumRegistrationModal = ({ isOpen, onClose, forumTitle }: ForumRegistrationModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Forum Registration">
      <div className="flex flex-col space-y-6">
        <div className="text-left">
          <p className="text-gray-500 text-sm">
            Join our upcoming Model UN forum session
            {forumTitle && <span className="block font-bold mt-1 text-gray-900">: {forumTitle}</span>}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/30 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Registration Form</h3>
            <p className="text-sm text-gray-400">Please fill in your details to register for the forum</p>
          </div>

          <div className="space-y-4">
            <Input 
              label="Full Name" 
              placeholder="Enter your full name" 
              className="bg-white border-slate-300"
            />
            
            <Input 
              label="Email" 
              placeholder="Enter your email address" 
              type="email"
              className="bg-white border-slate-300"
            />

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Preferred Country</label>
              <div className="relative flex items-center">
                <select 
                  defaultValue=""
                  className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-gray-600 transition-all focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/5"
                >
                  <option value="" disabled>Select a country</option>
                  <option value="usa">United States</option>
                  <option value="uk">United Kingdom</option>
                  <option value="korea">South Korea</option>
                  <option value="china">China</option>
                </select>
                <div className="absolute right-4 pointer-events-none text-gray-400">
                  <ChevronDown size={18} />
                </div>
              </div>
            </div>
          </div>

          <button className="w-full rounded-md border-2 border-slate-400 bg-white py-3.5 text-center font-bold text-gray-900 transition-all hover:bg-slate-50 active:scale-[0.98]">
            Submit Registration
          </button>
        </div>
      </div>
    </Modal>
  );
};
