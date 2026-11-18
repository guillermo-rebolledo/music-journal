"use client";

import { Disc3, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ArtistImage } from "@/lib/artist-artwork";

type ImageSource = { src: string; srcSet?: string; sizes?: string };

export function Artwork({ image, kind, detail = false }: {
  image?: ImageSource | null;
  kind: "album" | "artist";
  detail?: boolean;
}) {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const checkCachedImage = useCallback((element: HTMLImageElement | null) => {
    if (!element) return;
    // Let the browser select a srcset candidate before checking for a cached result.
    const frame = requestAnimationFrame(() => {
      if (element.complete && element.currentSrc) setState(element.naturalWidth ? "ready" : "missing");
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const missing = image === null || state === "missing";
  const ready = state === "ready";
  const Icon = kind === "album" ? Disc3 : UserRound;
  const label = kind === "artist" ? "No photo" : detail ? "No cover available" : "No cover";

  return (
    <span className={detail ? "artwork artwork-detail" : "artwork"} data-state={missing ? "missing" : ready ? "ready" : "loading"}>
      {image && !missing && (
        <img
          ref={checkCachedImage}
          alt=""
          width={250}
          height={250}
          loading={detail ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          sizes={image.sizes}
          srcSet={image.srcSet}
          src={image.src}
          onLoad={() => setState("ready")}
          onError={() => setState("missing")}
        />
      )}
      {missing && <span className="artwork-fallback"><Icon aria-hidden="true" />{label}</span>}
    </span>
  );
}

export function ArtistArtwork({ id, children }: { id: string; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<ArtistImage | null>();

  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const abort = new AbortController();
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      fetch(`/api/artwork/artist/${id}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]) })
        .then((response) => response.ok ? response.json() : null)
        .then((result) => { if (!abort.signal.aborted) setImage(result); })
        .catch(() => { if (!abort.signal.aborted) setImage(null); });
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => { observer.disconnect(); abort.abort(); };
  }, [id]);

  return (
    <div ref={anchor} className="artist-artwork">
      <Artwork kind="artist" image={image} />
      <div>
        {children}
        {image && (
          <small className="artist-artwork-credit">
            <a href={image.source} rel="noreferrer">{image.author || "Wikimedia Commons"}</a>
            {" · "}
            {image.licenseUrl ? <a href={image.licenseUrl} rel="noreferrer">{image.license}</a> : image.license}
          </small>
        )}
      </div>
    </div>
  );
}
