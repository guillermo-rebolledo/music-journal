import Link from "next/link";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create an account | Music Journal" };

export default async function SignUpPage() {
  if (await getListener()) {
    redirect("/journal");
  }

  return (
    <>
      <main id="main-content" tabIndex={-1} className="auth-page">
        <h1>Create an account</h1>
        <p>Start your private music Journal.</p>
        <AuthForm creatingAccount />
        <p className="auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
      </main>
    </>
  );
}
