import { useState, useEffect } from "react";

// Minimal duck-type — both ScryfallCard and CollectionCard satisfy this
export interface CardLike {
  name: string;
  image_uris: Record<string, string> | null;
  card_faces: Array<Record<string, unknown>> | null;
}

interface CardImageProps {
  card: CardLike;
  size?: "small" | "normal" | "large";
  className?: string;
  showHover?: boolean;
}

function getImageUrl(card: CardLike, size: "small" | "normal" | "large"): string | null {
  if (card.image_uris) return card.image_uris[size] || card.image_uris.normal || null;
  if (card.card_faces && card.card_faces[0]) {
    const face = card.card_faces[0] as { image_uris?: Record<string, string> };
    if (face.image_uris) return face.image_uris[size] || face.image_uris.normal || null;
  }
  return null;
}

export default function CardImage({ card, size = "normal", className = "", showHover = false }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = getImageUrl(card, size);

  if (!url || errored) {
    return (
      <div className={`bg-gray-800 flex items-center justify-center rounded-lg border border-gray-700 ${className}`}>
        <div className="text-center p-3">
          <div className="text-gray-500 text-xs font-medium">{card.name}</div>
          <div className="text-gray-600 text-xs mt-1">No image</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className} ${showHover ? "group" : ""}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-gray-800 animate-pulse rounded-lg" />
      )}
      <img
        src={url}
        alt={card.name}
        className={`rounded-lg transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"} w-full h-full object-cover`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        loading="lazy"
      />
    </div>
  );
}

// Full-screen modal shown when a card thumbnail is clicked
function CardModal({ card, onClose }: { card: CardLike; onClose: () => void }) {
  const url = getImageUrl(card, "large") || getImageUrl(card, "normal");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      {url ? (
        <img
          src={url}
          alt={card.name}
          className="max-h-[90vh] max-w-full rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="text-white text-sm">{card.name}</div>
      )}
    </div>
  );
}

// Hoverable + clickable card image:
//   Desktop — hover shows a side preview; click opens full-size modal
//   Mobile  — click opens full-size modal (no hover preview)
export function HoverCardImage({ card, children }: { card: CardLike; children: React.ReactNode }) {
  const [showHover, setShowHover] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const url = getImageUrl(card, "normal");

  return (
    <div
      className="relative inline-block cursor-pointer"
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
      onClick={() => setShowModal(true)}
    >
      {children}
      {/* Hover preview — desktop only */}
      {showHover && url && (
        <div className="absolute z-40 left-full top-0 ml-2 pointer-events-none hidden md:block">
          <img
            src={url}
            alt={card.name}
            className="w-56 rounded-xl shadow-2xl border border-gray-600"
          />
        </div>
      )}
      {showModal && <CardModal card={card} onClose={() => setShowModal(false)} />}
    </div>
  );
}
