import { groq } from "next-sanity";

const PRODUCT_FIELDS = groq`
  "id": _id,
  "slug": slug.current,
  name,
  tagline,
  description,
  priceCents,
  "available": coalesce(available, true),
  "category": category->title,
  "imageUrl": image.asset->url,
  ingredients,
  allergens
`;

export const ALL_PRODUCTS_QUERY = groq`
  *[_type == "product"] | order(priceCents asc, name asc) { ${PRODUCT_FIELDS} }
`;

export const PRODUCT_BY_SLUG_QUERY = groq`
  *[_type == "product" && slug.current == $slug][0] { ${PRODUCT_FIELDS} }
`;

export const PRODUCTS_BY_SLUGS_QUERY = groq`
  *[_type == "product" && slug.current in $slugs] { ${PRODUCT_FIELDS} }
`;

const DROP_FIELDS = groq`
  "id": _id,
  "slug": slug.current,
  title,
  status,
  ordersOpenAt,
  ordersCloseAt,
  pickupOrShipDate,
  note,
  "lineItems": lineItems[]{
    quantity,
    "product": product->{ ${PRODUCT_FIELDS} }
  }
`;

export const ACTIVE_DROP_QUERY = groq`
  *[_type == "drop" && status in ["open", "announced", "soldout"]]
    | order(pickupOrShipDate asc)[0] { ${DROP_FIELDS} }
`;

export const MEMBER_SELECTIONS_FOR_DROP_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId]{
    "id": _id,
    customerEmail,
    productSlug,
    "fulfillment": coalesce(fulfillment, "pickup"),
    shipInvoiceItemId,
    selectedAt
  }
`;

/** All active (or trialing) Bread Club members, sorted by sign-up. */
export const ACTIVE_MEMBERS_QUERY = groq`
  *[_type == "member" && subscriptionStatus in ["active", "trialing"]]
    | order(joinedAt asc){
      "id": _id,
      customerEmail,
      stripeCustomerId,
      subscriptionStatus,
      joinedAt
    }
`;

/** Count of active (or trialing) members. Used to enforce the seat cap. */
export const ACTIVE_MEMBER_COUNT_QUERY = groq`
  count(*[_type == "member" && subscriptionStatus in ["active", "trialing"]])
`;

/** A single member doc by email — needed when opening the Stripe Customer Portal. */
export const MEMBER_BY_EMAIL_QUERY = groq`
  *[_type == "member" && customerEmail == $email][0]{
    stripeCustomerId,
    subscriptionStatus,
    customerEmail
  }
`;
