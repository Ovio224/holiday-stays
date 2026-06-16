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
      {/* Tropical hero */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 text-6xl drop-shadow-sm" aria-hidden>
          🏝️
        </div>
        <h1 className="font-heading text-4xl font-extrabold text-gradient-sunset sm:text-5xl">
          Bali Stays
        </h1>
        <p className="mt-2 text-base text-foreground/70">
          Our trip&rsquo;s little corner of paradise. Enter the code to join the
          crew.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={[
          "glass flex flex-col gap-4 rounded-3xl border-0 bg-card/60 p-6 shadow-[0_30px_70px_-40px_var(--ocean)]",
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
          placeholder="Enter trip code"
          onChange={() => error && setError(null)}
          className="h-16 rounded-2xl bg-card/70 px-5 text-center text-xl font-semibold tracking-[0.18em] shadow-sm placeholder:tracking-normal placeholder:font-normal"
        />

        {error && (
          <p
            role="alert"
            className="text-center text-sm font-medium text-no"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isPending}
          className="h-16 w-full rounded-2xl bg-grad-sea text-lg font-semibold text-white shadow-lg shadow-ocean/25 hover:opacity-95"
        >
          {isPending ? "Checking…" : "Enter"}
        </Button>
      </form>

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
