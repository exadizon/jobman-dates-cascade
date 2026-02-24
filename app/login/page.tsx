"use client";

import { useActionState, useEffect, useState } from "react";
import { login } from "./actions";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(login, { success: false, error: null });
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.push("/");
      router.refresh(); // Ensure the layout and latest state is fetched
    }
  }, [state.success, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: "var(--color-bg)" }}>
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-3xl shadow-2xl p-8 sm:p-10 slide-up relative overflow-hidden">
        {/* Subtle decorative background gradient */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[var(--color-primary)] via-blue-400 to-[var(--color-primary)] opacity-80" />
        
        <div className="text-center mb-8 relative z-10">
          <div className="mx-auto w-16 h-16 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center mb-6 shadow-sm border border-blue-500/10 dark:border-blue-400/10">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text)] mb-2">Secure Access</h1>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Please enter the company password to view the internal dashboard.
          </p>
        </div>

        <form action={action} className="space-y-6 relative z-10">
          <div>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                id="password" 
                name="password" 
                required
                className="w-full pl-4 pr-12 py-3.5 bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all placeholder-[var(--color-text-muted)] group"
                placeholder="Enter password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus:outline-none transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          
          {state.error && (
            <div className="p-3.5 rounded-xl bg-[var(--color-danger-light)] border border-[var(--color-danger)]/20 text-[var(--color-danger)] text-sm flex items-start gap-3 fade-in shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
              <span className="font-medium">{state.error}</span>
            </div>
          )}

          <button 
            type="submit" 
            disabled={isPending}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-medium py-3.5 px-4 rounded-xl transition-all shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 transform active:scale-[0.98]"
          >
            {isPending ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white/90" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Authenticating...
              </>
            ) : "Unlock Dashboard"}
          </button>
        </form>
      </div>
      
      <p className="mt-8 text-sm text-[var(--color-text-muted)] font-medium tracking-wide">
        Inspire Kitchens Internal System &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}
