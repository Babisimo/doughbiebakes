import type { SchemaTypeDefinition } from "sanity";

import { categoryType } from "./category";
import { dropType } from "./drop";
import { memberType } from "./member";
import { memberSelectionType } from "./memberSelection";
import { orderType } from "./order";
import { promoCodeType } from "./promoCode";
import { productType } from "./product";
import { reservationType } from "./reservation";

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberType,
  memberSelectionType,
  reservationType,
  orderType,
  promoCodeType,
];
