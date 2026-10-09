"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useState } from "react";

export type DecorGalleryImage = {
  src: string;
  alt: string;
};

type HomeDecorGalleryProps = {
  images: DecorGalleryImage[];
};

export function HomeDecorGallery({ images }: HomeDecorGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const titleId = useId();

  const close = useCallback(() => setOpenIndex(null), []);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openIndex, close]);

  const open = openIndex !== null ? images[openIndex] : null;

  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {images.map((img, index) => (
          <div
            key={img.src}
            className="overflow-hidden rounded-lg border border-indigo-300/20 bg-zinc-950/40"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group relative aspect-square w-full cursor-zoom-in text-left outline-none ring-indigo-400/0 transition hover:ring-2 focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label={`Agrandir : ${img.alt}`}
            >
              <Image
                src={img.src}
                alt={img.alt}
                fill
                sizes="(max-width: 639px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 320px"
                className="object-cover transition duration-300 group-hover:scale-105"
                quality={90}
              />
            </button>
          </div>
        ))}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/90 backdrop-blur-sm"
            onClick={close}
            aria-label="Fermer la galerie"
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <p id={titleId} className="truncate text-sm font-medium text-zinc-100">
                {open.alt}
              </p>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-800"
              >
                Fermer
              </button>
            </div>
            <div className="relative mx-auto h-[min(65vh,min(85vw,520px))] w-full min-h-[160px] max-w-full">
              <Image
                src={open.src}
                alt={open.alt}
                fill
                sizes="(max-width: 768px) 90vw, 720px"
                quality={95}
                priority
                className="object-contain"
              />
            </div>
            <p className="text-center text-xs text-zinc-500">Échap ou clic hors image pour fermer.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
