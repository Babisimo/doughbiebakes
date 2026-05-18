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
  "createdAt": _createdAt,
  note,
  "lineItems": lineItems[]{
    quantity,
    "product": product->{ ${PRODUCT_FIELDS} }
  }
`;

export const RECENT_DROPS_QUERY = groq`
  *[_type == "drop" && status != "draft"]
    | order(coalesce(ordersCloseAt, pickupOrShipDate, _createdAt) desc)[0...8] {
    ${DROP_FIELDS}
  }
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

export const DROP_BY_ID_QUERY = groq`*[_type == "drop" && _id == $id][0] { ${DROP_FIELDS} }`;

export const RESERVATION_BY_ID_QUERY = groq`
  *[_type == "reservation" && _id == $id][0]{
    "id": _id, _rev, customerName, customerEmail, customerPhone,
    "dropId": drop._ref, status, totalCents, createdAt, decidedAt,
    items[]{ productSlug, productName, quantity, priceCents }
  }`;

// Anti-flood: an existing not-yet-decided reservation for this email + drop.
export const OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId
    && customerEmail == $email
    && status in ["unverified", "pending"]][0]{ "id": _id }`;

// Admin list: excludes unverified (not yet email-confirmed) reservations.
// Pending floats first; add a $limit/cutoff if volume grows.
export const RESERVATIONS_QUERY = groq`
  *[_type == "reservation" && status != "unverified"] | order(
    select(status == "pending" => 0, 1) asc, createdAt desc
  ){
    "id": _id, customerName, customerEmail, customerPhone,
    "dropTitle": drop->title, status, totalCents, createdAt, decidedAt,
    items[]{ productSlug, productName, quantity, priceCents }
  }`;

// Live (real-money) public orders for one drop, oldest first. Test-mode
// orders (livemode == false) are intentionally excluded from the bake list.
export const LIVE_ORDERS_FOR_DROP_QUERY = groq`
  *[_type == "order" && drop._ref == $dropId && livemode == true]
    | order(createdAt asc){
      "id": _id,
      "fulfillmentStatus": coalesce(fulfillmentStatus, "new"),
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      fulfillment,
      "shipAddress": shipAddress{ line1, line2, city, state, postalCode },
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;

// Confirmed reservations for one drop, oldest first. Pending/declined are
// excluded from the bake tally (pending is surfaced as a separate count).
export const CONFIRMED_RESERVATIONS_FOR_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId && status == "confirmed"]
    | order(createdAt asc){
      "id": _id,
      "fulfillmentStatus": coalesce(fulfillmentStatus, "new"),
      "customerEmail": customerEmail,
      "customerName": customerName,
      "customerPhone": customerPhone,
      totalCents,
      "items": items[]{ productSlug, productName, quantity }
    }`;

// Heads-up count only — pending reservations the baker hasn't decided yet.
export const PENDING_RESERVATION_COUNT_FOR_DROP_QUERY = groq`
  count(*[_type == "reservation" && drop._ref == $dropId && status == "pending"])`;
