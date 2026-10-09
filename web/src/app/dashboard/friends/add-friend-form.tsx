"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendFriendRequestAction } from "./actions";

export function AddFriendForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const fd = new FormData();
        fd.set("friendEmail", email);
        startTransition(async () => {
          const r = await sendFriendRequestAction(fd);
          if (r.ok) {
            setMsg({ type: "ok", text: "Invitation envoyée." });
            setEmail("");
            router.refresh();
          } else {
            setMsg({ type: "err", text: r.error });
          }
        });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="friendEmail" className="text-xs text-zinc-400">
            Email du compte AnimeBeat de ton ami·e
          </label>
          <input
            id="friendEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder="exemple@email.com"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "…" : "Inviter"}
        </button>
      </div>
      {msg ? (
        <p className={`text-sm ${msg.type === "ok" ? "text-emerald-400" : "text-amber-300"}`}>{msg.text}</p>
      ) : null}
    </form>
  );
}
