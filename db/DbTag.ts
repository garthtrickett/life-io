import { Context } from "effect";
import type { Kysely } from "kysely";
import type { Database } from "../types";

export class Db extends Context.Tag("Db")<Db, Kysely<Database>>() {}
