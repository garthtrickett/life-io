// FILE: components/pages/notes/detail/actions.ts
import { Effect, pipe, Ref, Fiber } from "effect";
import { rep } from "../../../../lib/client/replicache";
import { clientLog } from "../../../../lib/client/logger.client";
import { authState } from "../../../../lib/client/stores/authStore";
import type { Action, Model } from "./types";

export const handleAction = (
  action: Action,
  modelRef: Ref.Ref<Model>,
  propose: (action: Action) => void,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(modelRef);
    const userId = authState.value.user?.id;
    const noteId = currentModel.note?.id;

    yield* clientLog(
      "debug",
      `Handling action: ${action.type}`,
      userId,
      `NoteDetail(${noteId}):handleAction`,
    );

    switch (action.type) {
      case "DATA_UPDATED":
        yield* Ref.update(
          modelRef,
          (m): Model => ({
            ...m,
            status: "idle",
            note: action.payload.note,
            blocks: action.payload.blocks,
            error: null,
          }),
        );
        break;

      case "DATA_ERROR":
        yield* clientLog(
          "error",
          `Data error received: ${action.payload}`,
          userId,
          `NoteDetail(${noteId}):handleAction`,
        );
        yield* Ref.update(
          modelRef,
          (m): Model => ({
            ...m,
            status: "error",
            note: null,
            blocks: [],
            error: action.payload,
          }),
        );
        break;

      case "UPDATE_NOTE_CONTENT":
        if (currentModel.note) {
          const updatedNote = { ...currentModel.note, ...action.payload };
          yield* Ref.update(
            modelRef,
            (m): Model => ({
              ...m,
              note: updatedNote,
              status: "idle",
              error: null,
            }),
          );

          if (currentModel.saveFiber) {
            yield* Fiber.interrupt(currentModel.saveFiber);
          }
          const saveFiber = yield* pipe(
            Effect.sleep("500 millis"),
            Effect.andThen(() => propose({ type: "SAVE_NOTE_TO_REPLICACHE" })),
            Effect.asVoid,
            Effect.fork,
          );
          yield* Ref.update(modelRef, (m): Model => ({ ...m, saveFiber }));
        }
        break;

      case "SAVE_NOTE_TO_REPLICACHE": {
        if (!currentModel.note) return;
        yield* clientLog(
          "info",
          `Saving note ${currentModel.note.id} to Replicache.`,
          userId,
          `NoteDetail(${noteId}):saveNote`,
        );
        const saveEffect = pipe(
          Effect.tryPromise({
            try: () =>
              rep.mutate.updateNote({
                id: currentModel.note!.id,
                title: currentModel.note!.title,
                content: currentModel.note!.content,
              }),
            catch: (err) =>
              new Error(
                `Replicache mutator failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
          }),
          Effect.catchAll((error) =>
            clientLog(
              "error",
              `Failed to save note via Replicache: ${error.message}`,
              userId,
              `NoteDetail(${noteId}):saveNote`,
            ),
          ),
        );
        yield* Effect.fork(saveEffect);
        break;
      }
    }
  });
