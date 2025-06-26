import type { Migration } from "kysely";

import * as m2025062601 from "../../../migrations/2025062601_create_user";
import * as m2025062602 from "../../../migrations/2025062602_create_note";
import * as m2025062603 from "../../../migrations/2025062603_create_tag";
import * as m2025062604 from "../../../migrations/2025062604_create_note_tag";

export const centralMigrationObjects: Record<string, Migration> = {
  "2025062601_create_user": { up: m2025062601.up, down: m2025062601.down },
  "2025062602_create_note": { up: m2025062602.up, down: m2025062602.down },
  "2025062603_create_tag": { up: m2025062603.up, down: m2025062603.down },
  "2025062604_create_note_tag": {
    up: m2025062604.up,
    down: m2025062604.down,
  },
};
