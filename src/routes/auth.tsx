import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import billy from "@/assets/billy.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in to Billy — your cozy companion" },
      {
        name: "description",
        content:
          "Sign in to Billy, the gentle companion that keeps your thoughts and tasks safe and talks them through with you.",
      },
      { property: "og:title", content: "Sign in to Billy" },
      {
        property: "og:description",
        content: "A cozy companion for your thoughts, tasks and quieter days.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "reset" || window.location.hash.includes("type=recovery")) {
      setMode("reset");
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("reset");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading && session && mode !== "reset") navigate({ to: "/" });
  }, [loading, session, navigate, mode]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Almost there — check your inbox to confirm your email.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth?mode=reset`,
        });
        if (error) throw error;
        toast.success("Check your inbox — the link lets you set a password.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password saved. You can sign in with it anywhere now.");
        window.history.replaceState(null, "", "/auth");
        setMode("signin");
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in didn't go through. Try again?");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="paper-card w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center">
          <img src={billy} alt="Billy" width={816} height={816} className="h-24 w-24" />
          <h1 className="mt-3 text-3xl">Billy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A quiet place for your thoughts, and someone who remembers them.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          {mode === "forgot" && (
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send a link to set a new password.
            </p>
          )}
          {mode === "reset" && (
            <p className="text-sm text-muted-foreground">Choose your new password.</p>
          )}
          {mode !== "reset" && (
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
          {mode !== "forgot" && (
            <div className="space-y-2">
              <Label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {mode === "signin" && (
            <button
              type="button"
              className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
              onClick={() => setMode("forgot")}
            >
              Forgot or never set a password?
            </button>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "signup"
              ? "Create my space"
              : mode === "forgot"
                ? "Send me the link"
                : mode === "reset"
                  ? "Save my password"
                  : "Come back in"}
          </Button>
          {mode === "forgot" && (
            <button
              type="button"
              className="w-full text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setMode("signin")}
            >
              Back to sign in
            </button>
          )}
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle}>
          Continue with Google
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? "Already have a space?" : "First time here?"}{" "}
          <button
            type="button"
            className="font-semibold text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </main>
  );
}
