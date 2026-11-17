import Link from "next/link";

export default function NotFound() {
  return <main id="main-content" tabIndex={-1}>
    <p className="tag">404</p>
    <h1>Page not found</h1>
    <p>This page is unavailable. Return to your Journal to find your music.</p>
    <p><Link href="/journal">Back to Journal</Link></p>
  </main>;
}
