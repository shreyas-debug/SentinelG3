"use client"

import { signIn } from "next-auth/react"
import { Github, Chrome, Shield } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

function LoginContent() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || "/"

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo & Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-[var(--color-emerald)]/10 mb-6">
            <Shield className="h-12 w-12 text-[var(--color-emerald)]" />
          </div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
            Welcome to Sentinel-G3
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            AI-powered security scanning and automated vulnerability fixing
          </p>
        </div>

        {/* Login Options */}
        <div className="space-y-4 glass rounded-2xl p-8 border border-[var(--color-border)]">
          <button
            onClick={() => signIn("github", { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-[#24292e] hover:bg-[#2f363d] text-white font-semibold transition-colors"
          >
            <Github className="h-5 w-5" />
            Continue with GitHub
          </button>

          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-white hover:bg-gray-50 text-gray-900 font-semibold border border-gray-300 transition-colors"
          >
            <Chrome className="h-5 w-5" />
            Continue with Google
          </button>

          <div className="pt-4 text-center text-xs text-[var(--color-text-muted)]">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-[var(--color-emerald)]">5</div>
            <div className="text-xs text-[var(--color-text-muted)]">Scans/Day</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--color-cyan)]">∞</div>
            <div className="text-xs text-[var(--color-text-muted)]">Fixes</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-[var(--color-amber)]">AI</div>
            <div className="text-xs text-[var(--color-text-muted)]">Powered</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LoginContent />
    </Suspense>
  )
}
