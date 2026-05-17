import { site } from "@/lib/site";

/**
 * The disclosure California Cottage Food Operations must display. Keep the exact
 * "Made in a Home Kitchen" wording and your permit number current. Pass a
 * `className` to set the text color/size for the surface it sits on.
 */
export function CottageFoodNotice({
  className = "text-ink-700",
}: {
  className?: string;
}) {
  return (
    <p className={`text-xs leading-relaxed ${className}`}>
      <strong>{site.cottageFood.madeIn}.</strong> {site.name} operates as a
      California Cottage Food Operation ({site.cottageFood.permitNumber}) in{" "}
      {site.city}. Products are not prepared in an inspected facility. Sold within
      California only. Allergens are listed on each product and on the label.
    </p>
  );
}
