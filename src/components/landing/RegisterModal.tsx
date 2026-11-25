import React, { useState } from "react";
import { Mail, Lock, User, UserPlus, ChevronRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
}

export const RegisterModal = ({ isOpen, onClose, onSwitchToLogin }: RegisterModalProps) => {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (!agreed) {
      setError('Please agree to the terms of service.');
      return;
    }

    setLoading(true);
    try {
      await register(name, email, password);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create account">
      <form onSubmit={handleSubmit} className="flex flex-col space-y-6">
        {/* Content Heading */}
        <div className="text-center">
          <p className="text-sm text-gray-400 mt-1">
            Join our platform to participate in Model UN forums
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* Form */}
        <div className="space-y-4">
          <Input
            label="Full Name"
            placeholder="John Doe"
            type="text"
            icon={<User size={18} />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Email Address"
            placeholder="example@email.com"
            type="email"
            icon={<Mail size={18} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            placeholder="••••••••"
            type="password"
            icon={<Lock size={18} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label="Confirm Password"
            placeholder="••••••••"
            type="password"
            icon={<Lock size={18} />}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <div className="flex items-start gap-2 pt-2">
            <input
              type="checkbox"
              className="mt-1 rounded border-gray-300 text-brand focus:ring-brand/20"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <label className="text-xs font-semibold text-gray-500 leading-[1.4]">
              I agree to the{' '}
              <button type="button" className="text-brand hover:underline">Terms of Service</button>
              {' '}and{' '}
              <button type="button" className="text-brand hover:underline">Privacy Policy</button>
            </label>
          </div>
        </div>

        {/* CTA */}
        <div className="space-y-4 pt-4">
          <Button
            size="lg"
            type="submit"
            disabled={loading}
            className="w-full justify-between gap-2 bg-brand text-white hover:bg-brand-hover shadow-lg shadow-brand/20 disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <UserPlus size={20} />
              {loading ? 'Creating...' : 'Create Account'}
            </span>
            <ChevronRight size={20} />
          </Button>
        </div>

        {/* Footer Link */}
        <div className="text-center pt-4">
          <p className="text-sm font-medium text-gray-500">
            Already have an account?{' '}
            <button type="button" onClick={onSwitchToLogin} className="text-brand font-bold hover:underline">
              Log in
            </button>
          </p>
        </div>
      </form>
    </Modal>
  );
};

function getErrorMessage(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already in use.';
    case 'auth/invalid-email':
      return 'Invalid email format.';
    case 'auth/weak-password':
      return 'Password is too weak.';
    default:
      return 'An error occurred during sign-up.';
  }
}
