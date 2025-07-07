// lib/client/replicache/updateBlock.ts
import { Effect } from "effect";
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import {
  type WriteTransaction,
  type ReadonlyJSONValue,
  type JSONValue,
} from "replicache";
import type { BlockUpdate } from "../../../types/generated/public/Block";
import { BlockSchema } from "../../shared/schemas";
import { clientLog } from "../logger.client";
import { runClientPromise } from "../runtime";
import { withMutatorLogging } from "./helpers";

export async function updateBlock(
  tx: WriteTransaction,
  { id, ...update }: BlockUpdate & { id: string },
): Promise<void> {
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

    const block = yield* Schema.decodeUnknown(BlockSchema)(blockJSON).pipe(
      Effect.mapError((e) => new Error(formatErrorSync(e))),
    );

    const updated = {
      ...block,
      ...update,
      version: block.version + 1,
      updated_at: new Date(),
    };
    const validated = yield* Schema.decodeUnknown(BlockSchema)(updated).pipe(
      Effect.mapError(
        (e) =>
          new Error(`Updated block validation failed: ${formatErrorSync(e)}`),
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

  return runClientPromise(
    updateBlockEffect.pipe(withMutatorLogging("updateBlock")),
  );
}
