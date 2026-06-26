import { groq } from "next-sanity";

const PRODUCT_FIELDS = groq`
  "id": _id,
  "slug": slug.current,
  name,
  tagline,
  description,
  priceCents,
  defaultCostCents,
  "available": coalesce(available, true),
  "category": category->title,
  "imageUrl": image.asset->url,
  ingredients,
  allergens,
  "recipe": recipe[]{
    qtyPerLoaf,
    "ingredient": ingredient->{
      "id": _id,
      name,
      packagePriceCents,
      packageQty,
      unit
    }
  }
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
  flashSale,
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

const DROP_FINANCIALS_FIELDS = groq`
  "id": _id,
  "dropId": drop._ref,
  dropTitle,
  periodDate,
  "revenueCents": coalesce(revenueCents, 0),
  "listValueCents": coalesce(listValueCents, 0),
  "favorsCents": coalesce(favorsCents, 0),
  "variableCostCents": coalesce(variableCostCents, 0),
  "fixedCostCents": coalesce(fixedCostCents, 0),
  "netProfitCents": coalesce(netProfitCents, 0),
  "unitsTotal": coalesce(unitsTotal, 0),
  "actualCollectedCents": coalesce(actualCollectedCents, 0),
  savedAt
`;

export const ALL_DROP_FINANCIALS_QUERY = groq`
  *[_type == "dropFinancials"] | order(coalesce(periodDate, savedAt) desc) {
    ${DROP_FINANCIALS_FIELDS}
  }
`;

export const DROP_FINANCIALS_BY_DROP_QUERY = groq`
  *[_type == "dropFinancials" && drop._ref == $dropId][0]{
    ${DROP_FINANCIALS_FIELDS},
    "fixedCosts": fixedCosts[]{ name, "cents": coalesce(cents, 0) }
  }
`;

export const MEMBER_SELECTIONS_FOR_DROP_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId]{
    "id": _id,
    customerEmail,
    productSlug,
    "fulfillment": coalesce(fulfillment, "pickup"),
    "skipped": coalesce(skipped, false),
    selectedAt
  }
`;

/** All active Bread Club members, sorted by sign-up. */
export const ACTIVE_MEMBERS_QUERY = groq`
  *[_type == "member" && status == "active"]
    | order(joinedAt asc){
      "id": _id,
      customerEmail,
      stripeCustomerId,
      stripePaymentMethodId,
      "founding": coalesce(founding, false),
      joinedAt
    }
`;

/** Count of active members. Used to enforce the seat cap. */
export const ACTIVE_MEMBER_COUNT_QUERY = groq`
  count(*[_type == "member" && status == "active"])
`;

/** Count of members ever tagged founding — drives "founding spots left". */
export const FOUNDING_MEMBER_COUNT_QUERY = groq`
  count(*[_type == "member" && founding == true])
`;

/** A single member doc by email — needed when opening the Stripe Customer Portal. */
export const MEMBER_BY_EMAIL_QUERY = groq`
  *[_type == "member" && customerEmail == $email][0]{
    stripeCustomerId,
    status,
    customerEmail
  }
`;

export const DROP_BY_ID_QUERY = groq`*[_type == "drop" && _id == $id][0] { ${DROP_FIELDS} }`;

export const RESERVATION_BY_ID_QUERY = groq`
  *[_type == "reservation" && _id == $id][0]{
    "id": _id, _rev, customerName, customerEmail, customerPhone,
    "dropId": drop._ref, status, totalCents, createdAt, decidedAt,
    promoCode, promoPercentOff, discountedTotalCents, discountLabel,
    items[]{ productSlug, productName, quantity, priceCents }
  }`;

// Anti-flood: an existing not-yet-decided reservation for this email + drop.
// `status` rides along so the caller can tailor the user-facing message
// (unverified email vs. waiting on baker review).
export const OPEN_RESERVATION_FOR_EMAIL_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId
    && customerEmail == $email
    && status in ["unverified", "pending"]][0]{ "id": _id, status }`;

// Admin list: excludes unverified (not yet email-confirmed) reservations.
// Pending floats first; add a $limit/cutoff if volume grows.
export const RESERVATIONS_QUERY = groq`
  *[_type == "reservation" && status != "unverified"] | order(
    select(status == "pending" => 0, 1) asc, createdAt desc
  ){
    "id": _id, customerName, customerEmail, customerPhone, channel,
    "dropId": drop->_id, "dropTitle": drop->title, status, totalCents, collectedCents, createdAt, decidedAt,
    promoCode, promoPercentOff, discountedTotalCents, discountLabel,
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
      "items": items[]{ productSlug, productName, quantity, priceCents }
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
      collectedCents,
      promoPercentOff,
      "items": items[]{ productSlug, productName, quantity, priceCents }
    }`;

// Heads-up count only — pending reservations the baker hasn't decided yet.
export const PENDING_RESERVATION_COUNT_FOR_DROP_QUERY = groq`
  count(*[_type == "reservation" && drop._ref == $dropId && status == "pending"])`;

// Line items of every pending (email-confirmed, not yet decided) reservation
// for a drop — these "hold" stock so public availability reflects them.
export const PENDING_RESERVATION_ITEMS_FOR_DROP_QUERY = groq`
  *[_type == "reservation" && drop._ref == $dropId && status == "pending"]{
    items[]{ productSlug, quantity }
  }`;

/**
 * All memberSelection docs for a drop, raw (includes skipped ones) — the
 * per-drop charge route needs skip + fulfillment per member.
 */
export const MEMBER_SELECTIONS_RAW_FOR_DROP_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId]{
    customerEmail,
    productSlug,
    "fulfillment": coalesce(fulfillment, "pickup"),
    "skipped": coalesce(skipped, false)
  }`;

/**
 * One member's raw selection for a drop, keyed on drop + email — lets the
 * selection form seed whether a returning member already skipped this drop.
 */
export const MEMBER_SELECTION_RAW_FOR_EMAIL_QUERY = groq`
  *[_type == "memberSelection" && drop._ref == $dropId && customerEmail == $email][0]{
    productSlug,
    "skipped": coalesce(skipped, false)
  }`;

/** memberCharge docs for a drop — so the charge run knows who's already paid. */
export const MEMBER_CHARGES_FOR_DROP_QUERY = groq`
  *[_type == "memberCharge" && drop._ref == $dropId]{
    "id": _id,
    "customerId": member._ref,
    customerEmail,
    status,
    amountCents,
    failureMessage
  }`;
