import Link from "next/link";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in | Music Journal" };

export default async function SignInPage() {
  if (await getListener()) {
    redirect("/journal");
  }

  return (
    <>
      <header className="site-header">
        <span className="wordmark">Music Journal</span>
      </header>
      <main id="main-content" tabIndex={-1} className="auth-page">
        <h1>Sign in</h1>
        <p>Open your private Journal.</p>
        <AuthForm />
        <p className="auth-switch">New here? <Link href="/sign-up">Create an account</Link></p>
      </main>
    </>
  );
}
