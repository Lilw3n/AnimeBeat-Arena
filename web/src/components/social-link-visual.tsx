import Image from "next/image";
import Link from "next/link";
import { getSocialPreview, socialPreviewLabel, type SocialPreview } from "@/lib/social-url-preview";

const sizeClasses = {
  sm: "h-10 w-[71px] shrink-0",
  md: "h-24 w-44 max-w-[40%] shrink-0 sm:max-w-none",
} as const;

function FallbackCard({ preview, className }: { preview: Exclude<SocialPreview, { kind: "youtube" }>; className: string }) {
  const label = socialPreviewLabel(preview);
  const colors: Record<string, string> = {
    tiktok: "from-zinc-800 to-rose-950/80 border-rose-500/30",
    instagram: "from-zinc-800 to-fuchsia-950/80 border-fuchsia-500/30",
    x: "from-zinc-800 to-sky-950/80 border-sky-500/30",
    generic: "from-zinc-800 to-zinc-900 border-zinc-600/40",
  };
  const key = preview.kind === "generic" ? "generic" : preview.kind;
  return (
    <Link
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center rounded-lg border bg-gradient-to-br px-2 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:opacity-90 ${colors[key]} ${className}`}
    >
      {label}
    </Link>
  );
}

type Props = {
  url: string;
  size: keyof typeof sizeClasses;
  /** Si true, petite iframe YouTube sous la vignette (admin). */
  showYoutubeEmbed?: boolean;
  className?: string;
};

export function SocialLinkVisual({ url, size, showYoutubeEmbed = false, className = "" }: Props) {
  const preview = getSocialPreview(url);
  const box = `${sizeClasses[size]} overflow-hidden rounded-lg border border-zinc-600/50 bg-zinc-950 ${className}`;

  if (preview.kind === "youtube") {
    return (
      <div className={`flex flex-col gap-2 ${size === "md" ? "max-w-[min(100%,280px)]" : ""}`}>
        <Link
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`relative block ${box}`}
          title="Ouvrir sur YouTube"
        >
          <Image
            src={preview.thumbnailUrl}
            alt=""
            fill
            className="object-cover"
            sizes={size === "sm" ? "80px" : "280px"}
          />
        </Link>
        {showYoutubeEmbed && size === "md" ? (
          <div className={`${box} relative aspect-video w-full max-w-[280px]`}>
            <iframe
              title="Aperçu YouTube"
              src={`${preview.embedUrl}?rel=0`}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : null}
      </div>
    );
  }

  return <FallbackCard preview={preview} className={box} />;
}
