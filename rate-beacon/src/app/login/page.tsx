"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else setError("Wrong password — try again.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border p-8"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <h1 className="text-xl font-semibold">Rate Beacon</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Enter the dashboard password.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-lg border px-3 py-2 outline-none focus:ring-2"
          style={{ borderColor: "var(--baseline)", background: "var(--page)" }}
          placeholder="Password"
        />
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "Checking…" : "Open dashboard"}
        </button>
      </form>
    </main>
  );
}
