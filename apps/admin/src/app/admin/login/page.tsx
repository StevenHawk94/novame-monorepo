'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Stage =
  | { kind: 'email'; status: 'idle' | 'sending'; error: string | null }
  | { kind: 'code'; email: string; status: 'idle' | 'verifying'; error: string | null };

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/admin';
  const errorParam = searchParams.get('error');

  const [stage, setStage] = useState<Stage>({
    kind: 'email',
    status: 'idle',
    error: null,
  });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'email' || !email.trim() || stage.status === 'sending') return;

    setStage({ kind: 'email', status: 'sending', error: null });

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
        },
      });

      if (error) {
        setStage({ kind: 'email', status: 'idle', error: error.message });
      } else {
        setStage({
          kind: 'code',
          email: email.trim(),
          status: 'idle',
          error: null,
        });
      }
    } catch (err) {
      setStage({
        kind: 'email',
        status: 'idle',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'code' || code.length !== 6 || stage.status === 'verifying') return;

    setStage({ ...stage, status: 'verifying', error: null });

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: stage.email,
        token: code,
        type: 'email',
      });

      if (error) {
        setStage({ ...stage, status: 'idle', error: error.message });
        setCode('');
      } else {
        // Session cookie set; let middleware validate whitelist on redirect.
        router.push(redirectPath);
        router.refresh();
      }
    } catch (err) {
      setStage({
        ...stage,
        status: 'idle',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      setCode('');
    }
  };

  const goBackToEmail = () => {
    setStage({ kind: 'email', status: 'idle', error: null });
    setCode('');
  };

  const resendCode = async () => {
    if (stage.kind !== 'code') return;
    setStage({ ...stage, status: 'verifying', error: null });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: stage.email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        setStage({ ...stage, status: 'idle', error: error.message });
      } else {
        setStage({ ...stage, status: 'idle', error: null });
      }
    } catch (err) {
      setStage({
        ...stage,
        status: 'idle',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-black mb-2">NovaMe Admin</h1>
        <p className="text-sm text-gray-500 mb-6">
          {stage.kind === 'email'
            ? 'Sign in with a verification code sent to your email.'
            : `Code sent to ${stage.email}. Check your inbox.`}
        </p>

        {errorParam === 'unauthorized' && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            That account is not authorized to access this admin panel.
          </div>
        )}

        {stage.kind === 'email' ? (
          <form onSubmit={sendCode} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {stage.error && (
              <p className="text-xs text-red-600">{stage.error}</p>
            )}

            <button
              type="submit"
              disabled={!email.trim() || stage.status === 'sending'}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stage.status === 'sending' ? 'Sending...' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              required
              autoFocus
              autoComplete="one-time-code"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center text-lg font-mono tracking-widest text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {stage.error && (
              <p className="text-xs text-red-600">{stage.error}</p>
            )}

            <button
              type="submit"
              disabled={code.length !== 6 || stage.status === 'verifying'}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stage.status === 'verifying' ? 'Verifying...' : 'Verify & Sign In'}
            </button>

            <div className="flex justify-between text-xs pt-1">
              <button
                type="button"
                onClick={goBackToEmail}
                className="text-gray-500 hover:text-gray-700 underline"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={resendCode}
                disabled={stage.status === 'verifying'}
                className="text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
