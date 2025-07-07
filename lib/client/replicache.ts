// lib/client/replicache.ts
import {
  Replicache,
  type ReadonlyJSONValue,
  type WriteTransaction,
  type JSONValue,
} from "replicache";
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { BlockSchema, NoteSchema } from "../shared/schemas";
import type { BlockUpdate } from "../../types/generated/public/Block";
import { clientLog } from "./logger.client";
import { runClientPromise, runClientUnscoped } from "./runtime";
import type { NewNote } from "../../types/generated/public/Note";
import { toError } from "../shared/toError";
/* ───────────────────────────── Types ───────────────────────────────────── */

type Mutators = {
  createNote: (tx: WriteTransaction, note: NewNote) => Promise<void>;
  updateNote: (
    tx: WriteTransaction,
    update: { id: string; title: string; content: string },
  ) => Promise<void>;
  updateBlock: (
    tx: WriteTransaction,
    update: BlockUpdate & { id: string },
  ) => Promise<void>;
};

/* ────────────────────────── Global Instance ───────────────────────────── */

export let rep: Replicache<Mutators> | null = null;
/**
 * Clear the exported `rep` reference.
 * Called from the auth store after we’ve closed the instance on logout.
 */
export const nullifyReplicache = (): Effect.Effect<void> =>
  Effect.sync(() => {
    rep = null;
  });
/* ──────────────────────────── Helpers ─────────────────────────────────── */

/** Safely stringify anything for logging so we avoid @typescript-eslint/no-base-to-string */
function stringifyForLog(value: unknown): string {
  if (value == null) return "";
  // null | undefined
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/* ────────────────────────── Initialiser ───────────────────────────────── */

export const initReplicache = (
  userId: string,
): Effect.Effect<Replicache<Mutators>> =>
  Effect.gen(function* () {
    /* Close any previous instance first */
    if (rep) {
      yield* clientLog(
        "warn",
        "Closing existing Replicache instance before creating a new one.",
      );
      yield* Effect.promise(() => rep!.close());
    }

    const newRep = new Replicache<Mutators>({
      logLevel: "debug",
      name: `life-io-user-${userId}`,
      licenseKey: "l10f93d37bcd041beba8d111a72da0031",
      pushURL: "/api/replicache/push",
      pullURL: "/api/replicache/pull",
      pushDelay: 200,
      pullInterval: 60_000,

      /* ──────────────── Mutators ──────────────── */
      mutators: {
        /* ---------------- createNote ---------------- */
        async createNote(tx: WriteTransaction, args: NewNote) {
          const createNoteEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: createNote for id ${args.id}`,
              args.user_id,
              "Replicache:createNote",
            );
            const key = `note/${args.id}`;
            const now = new Date();

            const note = yield* Schema.decodeUnknown(NoteSchema)({
              ...args,
              created_at: now,
              updated_at: now,
            }).pipe(
              Effect.mapError(
                (e) =>
                  new Error(`Note validation failed: ${formatErrorSync(e)}`),
              ),
            );
            const noteForJSON: ReadonlyJSONValue = {
              ...note,
              created_at: note.created_at.toISOString(),
              updated_at: note.updated_at.toISOString(),
            };
            yield* Effect.promise(() => tx.set(key, noteForJSON));
          });

          const handled = createNoteEffect.pipe(
            Effect.catchAll((err) => {
              const error = toError(err);
              const cause =
                error.cause !== undefined
                  ? ` | Cause: ${stringifyForLog(error.cause)}`
                  : "";
              return clientLog(
                "error",
                `Error in createNote mutator: ${error.message}${cause}`,
              );
            }),
          );

          return runClientPromise(handled);
        },

        /* ---------------- updateNote ---------------- */
        async updateNote(tx, { id, title, content }) {
          const updateNoteEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: updateNote for id ${id}`,
              undefined,
              "Replicache:updateNote",
            );

            const key = `note/${id}`;
            const noteJSON = yield* Effect.promise(() => tx.get(key));

            if (noteJSON === undefined) {
              return yield* Effect.fail(
                new Error(`Note with id ${id} not found for update.`),
              );
            }

            const note = yield* Schema.decodeUnknown(NoteSchema)(noteJSON).pipe(
              Effect.mapError((e) => new Error(formatErrorSync(e))),
            );

            const updated = {
              ...note,
              title,
              content,
              updated_at: new Date(),
            };

            const validated = yield* Schema.decodeUnknown(NoteSchema)(
              updated,
            ).pipe(
              Effect.mapError(
                (e) =>
                  new Error(
                    `Updated note validation failed: ${formatErrorSync(e)}`,
                  ),
              ),
            );
            const updatedForJSON: ReadonlyJSONValue = {
              ...validated,
              created_at: validated.created_at.toISOString(),
              updated_at: validated.updated_at.toISOString(),
            };
            yield* Effect.promise(() => tx.set(key, updatedForJSON));
          });

          const handled = updateNoteEffect.pipe(
            Effect.catchAll((err) => {
              const error = toError(err);
              const cause =
                error.cause !== undefined
                  ? ` | Cause: ${stringifyForLog(error.cause)}`
                  : "";
              return clientLog(
                "error",
                `Error in updateNote mutator: ${error.message}${cause}`,
              );
            }),
          );

          return runClientPromise(handled);
        },

        /* ---------------- updateBlock ---------------- */
        async updateBlock(tx, { id, ...update }) {
          const updateBlockEffect = Effect.gen(function* () {
            yield* clientLog(
              "info",
              `Executing mutator: updateBlock for id ${id}`,
              undefined,
              "Replicache:updateBlock",
            );

            const key = `block/${id}`;
            const blockJSON = (yield* Effect.promise(() => tx.get(key))) as
              | JSONValue
              | undefined;

            if (blockJSON === undefined) {
              return yield* Effect.fail(
                new Error(`Block with id ${id} not found for update`),
              );
            }

            const block = yield* Schema.decodeUnknown(BlockSchema)(
              blockJSON,
            ).pipe(Effect.mapError((e) => new Error(formatErrorSync(e))));

            const updated = {
              ...block,
              ...update,
              version: block.version + 1,
              updated_at: new Date(),
            };
            const validated = yield* Schema.decodeUnknown(BlockSchema)(
              updated,
            ).pipe(
              Effect.mapError(
                (e) =>
                  new Error(
                    `Updated block validation failed: ${formatErrorSync(e)}`,
                  ),
              ),
            );
            const updatedForJSON: ReadonlyJSONValue = {
              ...validated,
              created_at: validated.created_at.toISOString(),
              updated_at: validated.updated_at.toISOString(),
              fields: validated.fields as JSONValue,
            };
            yield* Effect.promise(() => tx.set(key, updatedForJSON));
          });

          const handled = updateBlockEffect.pipe(
            Effect.catchAll((err) => {
              const error = toError(err);
              const cause =
                error.cause !== undefined
                  ? ` | Cause: ${stringifyForLog(error.cause)}`
                  : "";
              return clientLog(
                "error",
                `Error in updateBlock mutator: ${error.message}${cause}`,
              );
            }),
          );

          return runClientPromise(handled);
        },
      },
    });

    rep = newRep;
    setupWebSocket();
    yield* clientLog("info", `Replicache initialized for user: ${userId}`);
    return newRep;
  }).pipe(
    Effect.catchAll((err) =>
      clientLog(
        "error",
        `Critical error during Replicache initialization: ${
          toError(err).message
        }`,
      ).pipe(Effect.andThen(Effect.die(err))),
    ),
  );
/* ──────────────────────────── WebSocket ───────────────────────────────── */

function setupWebSocket() {
  const ws = new WebSocket(
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`,
  );

  // ======================== START OF FIX ========================
  // The onmessage handler must be async and must await the rep.pull() call.
  ws.onmessage = async (event) => {
    runClientUnscoped(
      clientLog(
        "info",
        `Received WebSocket message with data: "${String(event.data)}"`,
        undefined,
        "Replicache:WS",
      ),
    );

    if (event.data === "poke" && rep) {
      runClientUnscoped(
        clientLog(
          "info",
          "Poke received, triggering pull...",
          undefined,
          "Replicache:WS",
        ),
      );
      try {
        // Awaiting the pull is critical to prevent the "out of scope" error.
        await rep.pull();
      } catch (e) {
        runClientUnscoped(
          clientLog(
            "error",
            `Error executing pull after poke: ${toError(e).message}`,
          ),
        );
      }
    }
  };
  // ========================= END OF FIX =========================
}
