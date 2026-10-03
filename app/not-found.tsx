import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="fallback-page" id="main-content">
      <section className="fallback-card" aria-labelledby="not-found-title">
        <span className="fallback-icon">
          <Compass size={32} aria-hidden="true" />
        </span>
        <p className="fallback-eyebrow">TOP CRYPTO SIGNALS · 404</p>
        <h1 id="not-found-title">This page is off the map.</h1>
        <p>
          The link may be incomplete. Open the dashboard to explore markets, analytics and signals.
        </p>
        <div className="fallback-actions">
          <Link href="/">Open dashboard</Link>
        </div>
      </section>
    </main>
  );
}
