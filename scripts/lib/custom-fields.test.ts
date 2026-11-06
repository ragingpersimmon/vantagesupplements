import assert from "node:assert/strict";
import { it } from "node:test";
import { FIELD_DEFS, SEARCHABLE_FIELD_TYPES } from "./custom-fields";

it("only marks field types Spree can search as searchable", () => {
  for (const def of FIELD_DEFS) {
    if (def.searchable) assert.ok(SEARCHABLE_FIELD_TYPES.includes(def.field_type), def.key);
  }
});
