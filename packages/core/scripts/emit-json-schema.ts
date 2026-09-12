/**
 * Writes `packages/core/schema/yumml-v1.schema.json` from the wire schema.
 *
 * Run with `pnpm schema` after changing `src/schema/wire.ts`. A test regenerates
 * the same bytes and fails when the checked-in file is stale, so this cannot
 * quietly drift from the parser.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchemaText } from "../src/schema/json-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "schema", "yumml-v1.schema.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, jsonSchemaText(), "utf8");
console.log(`wrote ${target}`);
