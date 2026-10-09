import type { SiteConfig } from "@/generated/prisma";

const LEGACY_INVITE = "https://discord.gg/stCNfkNCYD";

export type ResolvedDiscordCommunity = {
  inviteUrl: string;
  /** Lien direct vers le salon (app / web Discord). */
  communityChannelUrl: string | null;
  /** ID serveur pour le widget embarqué (Discord → Paramètres serveur → Widget). */
  widgetServerId: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Fusionne la config admin (base) et les variables d’environnement publiques.
 */
export function resolveDiscordCommunity(
  config: Pick<
    SiteConfig,
    "discordInviteUrl" | "discordCommunityChannelUrl" | "discordWidgetServerId"
  >,
): ResolvedDiscordCommunity {
  const inviteUrl =
    trimOrNull(config.discordInviteUrl) ??
    trimOrNull(process.env.NEXT_PUBLIC_DISCORD_INVITE_URL) ??
    LEGACY_INVITE;

  const communityChannelUrl =
    trimOrNull(config.discordCommunityChannelUrl) ??
    trimOrNull(process.env.NEXT_PUBLIC_DISCORD_COMMUNITY_CHANNEL_URL);

  const widgetServerId =
    trimOrNull(config.discordWidgetServerId) ??
    trimOrNull(process.env.NEXT_PUBLIC_DISCORD_WIDGET_SERVER_ID);

  return { inviteUrl, communityChannelUrl, widgetServerId };
}

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID?.trim() && process.env.DISCORD_CLIENT_SECRET?.trim(),
  );
}
