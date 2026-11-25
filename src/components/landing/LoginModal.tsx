import React, { useState } from "react";
import { Mail, Lock, LogIn, ChevronRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToRegister: () => void;
}

export const LoginModal = ({ isOpen, onClose, onSwitchToRegister }: LoginModalProps) => {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      onClose();
      setEmail('');
      setPassword('');
    } catch (err: any) {
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email to reset your password.');
      return;
    }
    setError('');
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err: any) {
      setError(getErrorMessage(err.code));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Welcome back">
      <form onSubmit={handleSubmit} className="flex flex-col space-y-8">
        {/* Content Heading */}
        <div className="text-center">
          <h3 className="text-lg font-bold text-gray-900">Log in to Account</h3>
          <p className="text-sm text-gray-400 mt-1">
            Enter your credentials to access the platform
          </p>
        </div>

        {/* Error / Success */}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}
        {resetSent && (
          <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-600">
            Password reset email sent.
          </p>
        )}

        {/* Form */}
        <div className="space-y-4">
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
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-600">
              <input type="checkbox" className="rounded border-gray-300 text-brand focus:ring-brand/20" />
              Remember me
            </label>
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-sm font-bold text-brand hover:underline"
            >
              Forgot Password?
            </button>
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
              <LogIn size={20} />
              {loading ? 'Signing in...' : 'Sign In'}
            </span>
            <ChevronRight size={20} />
          </Button>
        </div>

        {/* Switch to Register */}
        <div className="text-center pt-4">
          <p className="text-sm font-medium text-gray-500">
            Don&apos;t have an account?{" "}
            <button type="button" onClick={onSwitchToRegister} className="text-brand font-bold hover:underline">
              Sign up
            </button>
          </p>
        </div>
      </form>
    </Modal>
  );
};

function getErrorMessage(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many login attempts. Please try again later.';
    case 'auth/invalid-email':
      return 'Invalid email format.';
    default:
      return 'An error occurred during login.';
  }
}
