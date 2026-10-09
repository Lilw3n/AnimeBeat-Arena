import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";

const SITE_CONFIG_ID = 1;
const DEFAULT_CONFIG = {
  id: SITE_CONFIG_ID,
  liveTvEnabled: true,
  discordInviteUrl: null as string | null,
  discordCommunityChannelUrl: null as string | null,
  discordWidgetServerId: null as string | null,
  updatedAt: new Date(0),
};

/**
 * Tolère l’absence de Postgres pendant le build (ex. .env encore en SQLite)
 * ou une erreur réseau : évite de casser le prerender des pages statiques.
 */
export async function getSiteConfig() {
  if (!isDatabaseConfigured()) {
    return DEFAULT_CONFIG;
  }
  try {
    const prisma = getPrisma();
    return await prisma.siteConfig.upsert({
      where: { id: SITE_CONFIG_ID },
      update: {},
      create: {
        id: SITE_CONFIG_ID,
        liveTvEnabled: true,
        discordInviteUrl: null,
        discordCommunityChannelUrl: null,
        discordWidgetServerId: null,
      },
    });
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setLiveTvEnabled(enabled: boolean) {
  const prisma = getPrisma();
  return prisma.siteConfig.upsert({
    where: { id: SITE_CONFIG_ID },
    update: { liveTvEnabled: enabled },
    create: {
      id: SITE_CONFIG_ID,
      liveTvEnabled: enabled,
      discordInviteUrl: null,
      discordCommunityChannelUrl: null,
      discordWidgetServerId: null,
    },
  });
}

export async function setDiscordCommunityFields(input: {
  discordInviteUrl: string | null;
  discordCommunityChannelUrl: string | null;
  discordWidgetServerId: string | null;
}) {
  const prisma = getPrisma();
  return prisma.siteConfig.upsert({
    where: { id: SITE_CONFIG_ID },
    update: {
      discordInviteUrl: input.discordInviteUrl,
      discordCommunityChannelUrl: input.discordCommunityChannelUrl,
      discordWidgetServerId: input.discordWidgetServerId,
    },
    create: {
      id: SITE_CONFIG_ID,
      liveTvEnabled: true,
      discordInviteUrl: input.discordInviteUrl,
      discordCommunityChannelUrl: input.discordCommunityChannelUrl,
      discordWidgetServerId: input.discordWidgetServerId,
    },
  });
}
