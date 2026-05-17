import type { SchemaTypeDefinition } from "sanity";

import { categoryType } from "./category";
import { dropType } from "./drop";
import { memberType } from "./member";
import { memberSelectionType } from "./memberSelection";
import { productType } from "./product";

export const schemaTypes: SchemaTypeDefinition[] = [
  productType,
  categoryType,
  dropType,
  memberType,
  memberSelectionType,
];
