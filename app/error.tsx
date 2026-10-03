"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard-render-failed", error.digest ?? "no-digest");
  }, [error.digest]);

  return (
    <main className="fallback-page" id="main-content">
      <section className="fallback-card" aria-labelledby="error-title">
        <span className="fallback-icon">
          <ShieldAlert size={32} aria-hidden="true" />
        </span>
        <p className="fallback-eyebrow">TOP CRYPTO SIGNALS</p>
        <h1 id="error-title">The dashboard could not load.</h1>
        <p>A display error interrupted this view. Try loading it again.</p>
        <div className="fallback-actions">
          <button onClick={reset}>
            <RefreshCw size={15} aria-hidden="true" /> Try again
          </button>
          <Link href="/">Return to dashboard</Link>
        </div>
      </section>
    </main>
  );
}
