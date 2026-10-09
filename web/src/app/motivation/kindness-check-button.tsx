"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { kindnessCheckInAction } from "./actions";

export function KindnessCheckButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setFeedback(null);
          startTransition(async () => {
            const r = await kindnessCheckInAction();
            if (r.ok) {
              setFeedback("Merci pour ce moment : un peu d’XP a été ajouté avec douceur.");
              router.refresh();
            } else if (r.reason === "already") {
              setFeedback("Tu as déjà honoré ta pause bienveillante aujourd’hui. À demain.");
            } else {
              setFeedback("Enregistre d’abord ton profil ci-dessous.");
            }
          });
        }}
        className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "…" : "Mon instant bienveillant du jour (+XP)"}
      </button>
      {feedback ? <p className="text-sm text-zinc-300">{feedback}</p> : null}
    </div>
  );
}
