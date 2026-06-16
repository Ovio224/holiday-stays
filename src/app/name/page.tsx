// The "who are you?" screen. Server component: loads the current member list so
// the picker can render existing names; the cookie-setting happens in the
// client <NamePicker /> via server actions. Always dynamic — the member list is
// live and per-request.

import { getMembers } from "@/lib/data";
import { NamePicker } from "@/components/name-picker";

export const dynamic = "force-dynamic";

export default async function NamePage() {
  const members = await getMembers();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <NamePicker members={members} />
    </main>
  );
}
