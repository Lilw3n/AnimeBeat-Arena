import type { User, UserProfile } from "@/generated/prisma";
import {
  visibleDiscordUsername,
  visibleEmailForFriend,
  visibleLocationLines,
} from "@/lib/profile-visibility";
import {
  acceptFriendshipAction,
  cancelFriendRequestAction,
  declineFriendshipAction,
  removeFriendAction,
} from "./actions";

type Other = Pick<User, "id" | "email" | "name" | "discordUsername"> & {
  profile: UserProfile | null;
};

export function FriendCard({
  friendshipId,
  other,
  variant,
}: {
  friendshipId: string;
  other: Other;
  variant: "incoming" | "outgoing" | "accepted";
}) {
  const label = other.name?.trim() || other.email;
  const isFriend = variant === "accepted";
  const ctx = { isSelf: false, isFriend };

  const locLines = visibleLocationLines(other.profile, ctx);
  const discord = visibleDiscordUsername(other.discordUsername, other.profile, ctx);
  const emailShown = visibleEmailForFriend(other.email, other.profile, ctx);
  const hasLocationData = Boolean(
    other.profile?.locationCountry ||
      other.profile?.locationDepartment ||
      other.profile?.locationCity ||
      other.profile?.locationDetail,
  );
  const locationMasked = hasLocationData && locLines.length === 0;

  return (
    <li className="rounded-xl border border-zinc-700/60 bg-zinc-950/40 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium text-zinc-100">{label}</p>
          {variant !== "accepted" ? (
            <p className="text-xs text-zinc-500">{other.email}</p>
          ) : emailShown ? (
            <p className="text-xs text-zinc-400">{emailShown}</p>
          ) : (
            <p className="text-xs text-zinc-500">Email masqué par les préférences</p>
          )}
          {discord ? (
            <p className="text-xs text-emerald-400/90">Discord : @{discord}</p>
          ) : other.discordUsername ? (
            <p className="text-xs text-zinc-600">Discord masqué par les préférences</p>
          ) : null}
          {locLines.length > 0 ? (
            <ul className="mt-2 text-xs text-zinc-400">
              {locLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : locationMasked ? (
            <p className="mt-2 text-xs text-zinc-600">Localisation masquée par les préférences de cette personne.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {variant === "incoming" ? (
            <>
              <form action={acceptFriendshipAction}>
                <input type="hidden" name="friendshipId" value={friendshipId} />
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Accepter
                </button>
              </form>
              <form action={declineFriendshipAction}>
                <input type="hidden" name="friendshipId" value={friendshipId} />
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Refuser
                </button>
              </form>
            </>
          ) : null}
          {variant === "outgoing" ? (
            <form action={cancelFriendRequestAction}>
              <input type="hidden" name="friendshipId" value={friendshipId} />
              <button
                type="submit"
                className="rounded-lg border border-amber-600/50 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40"
              >
                Annuler l’invitation
              </button>
            </form>
          ) : null}
          {variant === "accepted" ? (
            <form action={removeFriendAction}>
              <input type="hidden" name="friendshipId" value={friendshipId} />
              <button
                type="submit"
                className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
              >
                Retirer des ami·e·s
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}
