// The gate: the single shared-code entry point. Full-height, centered, all the
// visual weight on the code form. The actual verification lives in <GateForm />.

import { GateForm } from "@/components/gate-form";

export default function GatePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <GateForm />
    </main>
  );
}
