"use client";

// The single-code gate. One shared code lets the whole friend group in. On
// success we route to the board; on failure we shake the input and surface the
// message inline + as a toast.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { verifyGateCode } from "@/actions/gate";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function GateForm() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setError(null);
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") ?? "").trim();
    if (!code) {
      flagError("Enter the code to come in.");
      return;
    }

    startTransition(async () => {
      try {
        // The action may return { ok: true } on success, or a non-ok result
        // carrying an error message. Read it loosely so we don't couple to its
        // exact return shape.
        const result = (await verifyGateCode(formData)) as unknown as
          | { ok?: boolean; error?: string }
          | undefined;
        if (result?.ok) {
          router.push("/");
          router.refresh();
          return;
        }
        // Non-ok result → surface its reason if there is one.
        const message = result?.error || "That code didn't work. Try again.";
        flagError(message);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong. Try again.";
        flagError(message);
      }
    });
  }

  // Show the message inline, toast it, and trigger the shake animation once.
  function flagError(message: string) {
    setError(message);
    toast.error(message);
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }

  return (
    <div className="w-full max-w-md animate-pop-in">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-primary">Bali Stays</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your trip code to continue.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={[
            "flex flex-col gap-4",
            shake ? "animate-[gate-shake_0.4s_ease-in-out]" : "",
          ].join(" ")}
        >
          <label htmlFor="gate-code" className="sr-only">
            Trip code
          </label>
          <Input
            id="gate-code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-invalid={Boolean(error)}
            placeholder="Trip code"
            onChange={() => error && setError(null)}
            className="h-14 rounded-lg px-4 text-center text-lg font-medium tracking-[0.08em] placeholder:font-normal placeholder:tracking-normal"
          />

          {error && (
            <p role="alert" className="text-center text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="h-12 w-full rounded-lg bg-primary text-base font-semibold text-white hover:bg-[#e00b41]"
          >
            {isPending ? "Checking…" : "Enter"}
          </Button>
        </form>
      </div>

      {/* Local keyframes for the wrong-code shake. */}
      <style>{`
        @keyframes gate-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[gate-shake_0\\.4s_ease-in-out\\] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
