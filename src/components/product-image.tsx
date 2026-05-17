import Image from "next/image";

/**
 * Product photo with a graceful fallback: until real photos are uploaded
 * (seed menu) we show a juicy orange→gold tile so cards still look intentional.
 */
export function ProductImage({
  src,
  alt,
  className = "",
  sizes = "(min-width: 768px) 33vw, 100vw",
  priority = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden bg-bone-200 ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center panel-acid">
          <span
            className="text-6xl drop-shadow-[0_4px_12px_rgba(61,28,2,0.25)]"
            aria-hidden
          >
            🍞
          </span>
          <span className="sr-only">{alt}</span>
        </div>
      )}
    </div>
  );
}
