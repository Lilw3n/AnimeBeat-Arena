"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProfileLocationVisibility } from "@/generated/prisma";
import { LOCATION_VISIBILITY_LABELS } from "@/lib/profile-visibility";
import { saveUserProfileAction } from "./actions";

type Initial = {
  bio: string | null;
  locationCountry: string | null;
  locationDepartment: string | null;
  locationCity: string | null;
  locationDetail: string | null;
  locationVisibility: ProfileLocationVisibility;
  showEmailToFriends: boolean;
  showDiscordToFriends: boolean;
  showDiscordOnPublicProfile: boolean;
};

export function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-6 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await saveUserProfileAction(fd);
          if (r.ok) {
            setMsg({ type: "ok", text: "Profil enregistré." });
            router.refresh();
          } else {
            setMsg({ type: "err", text: r.error });
          }
        });
      }}
    >
      <div>
        <label htmlFor="bio" className="block text-sm font-medium text-zinc-200">
          Bio (optionnel)
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={500}
          defaultValue={initial.bio ?? ""}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          placeholder="Quelques mots sur toi…"
        />
      </div>

      <fieldset className="space-y-3 rounded-xl border border-zinc-700/60 p-4">
        <legend className="px-1 text-sm font-medium text-zinc-200">D’où tu viens (100 % optionnel)</legend>
        <p className="text-xs text-zinc-500">
          Remplis seulement ce que tu veux : pays, département, ville, ou une précision (rue, quartier…). Rien n’est
          obligatoire.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="locCountry" className="text-xs text-zinc-400">
              Pays
            </label>
            <input
              id="locCountry"
              name="locationCountry"
              defaultValue={initial.locationCountry ?? ""}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label htmlFor="locDept" className="text-xs text-zinc-400">
              Département / région
            </label>
            <input
              id="locDept"
              name="locationDepartment"
              defaultValue={initial.locationDepartment ?? ""}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label htmlFor="locCity" className="text-xs text-zinc-400">
              Ville
            </label>
            <input
              id="locCity"
              name="locationCity"
              defaultValue={initial.locationCity ?? ""}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="locDetail" className="text-xs text-zinc-400">
              Précision (adresse, quartier… — le plus sensible)
            </label>
            <input
              id="locDetail"
              name="locationDetail"
              defaultValue={initial.locationDetail ?? ""}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="locVis" className="block text-xs font-medium text-zinc-300">
            Qui peut voir ces infos de lieu ?
          </label>
          <select
            id="locVis"
            name="locationVisibility"
            defaultValue={initial.locationVisibility}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          >
            {(Object.keys(LOCATION_VISIBILITY_LABELS) as ProfileLocationVisibility[]).map((k) => (
              <option key={k} value={k}>
                {LOCATION_VISIBILITY_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-zinc-700/60 p-4">
        <legend className="px-1 text-sm font-medium text-zinc-200">Confidentialité &amp; Discord</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="showEmailToFriends"
            defaultChecked={initial.showEmailToFriends}
            className="mt-1 h-4 w-4 accent-violet-600"
          />
          <span>Montrer mon email aux ami·e·s accepté·e·s</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="showDiscordToFriends"
            defaultChecked={initial.showDiscordToFriends}
            className="mt-1 h-4 w-4 accent-violet-600"
          />
          <span>Montrer mon pseudo Discord aux ami·e·s (si compte Discord lié)</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="showDiscordOnPublicProfile"
            defaultChecked={initial.showDiscordOnPublicProfile}
            className="mt-1 h-4 w-4 accent-violet-600"
          />
          <span>Montrer mon Discord aux visiteurs (profil public — à utiliser avec prudence)</span>
        </label>
        <p className="text-xs text-zinc-500">
          Lie Discord depuis la page{" "}
          <a href="/login" className="text-cyan-400 hover:text-cyan-300">
            Connexion
          </a>{" "}
          ou{" "}
          <a href="/community" className="text-cyan-400 hover:text-cyan-300">
            Communauté
          </a>
          .
        </p>
      </fieldset>

      {msg ? (
        <p className={msg.type === "ok" ? "text-sm text-emerald-400" : "text-sm text-amber-300"}>{msg.text}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? "Enregistrement…" : "Enregistrer le profil"}
      </button>
    </form>
  );
}
