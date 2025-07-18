// FILE: components/pages/notes/list/actions.ts
import { Effect, pipe, Ref } from "effect";
import { rep } from "../../../../lib/client/replicache";
import { navigate } from "../../../../lib/client/router";
import { clientLog } from "../../../../lib/client/logger.client";
import { authState } from "../../../../lib/client/stores/authStore";
import type { Action, Model } from "./types";
import { NoteId } from "../../../../types/generated/public/Note";
import { runClientUnscoped } from "../../../../lib/client/runtime";

export const handleAction = (
  action: Action,
  modelRef: Ref.Ref<Model>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(modelRef);
    const userId = authState.value.user?.id;

    yield* clientLog(
      "debug",
      `Handling action: ${action.type}`,
      userId,
      "NotesList:handleAction",
    );

    switch (action.type) {
      case "NOTES_UPDATED": {
        yield* Ref.set(modelRef, {
          ...currentModel,
          isLoading: false,
          notes: action.payload,
        });
        break;
      }
      case "DATA_ERROR":
        yield* clientLog(
          "error",
          `Data error received: ${action.payload}`,
          userId,
          "NotesList:handleAction",
        );
        yield* Ref.set(modelRef, {
          ...currentModel,
          isLoading: false,
          error: action.payload,
        });
        break;

      case "CREATE_NOTE_START": {
        yield* Ref.set(modelRef, {
          ...currentModel,
          isCreating: true,
          error: null,
        });
        const createEffect = pipe(
          Effect.gen(function* () {
            if (!rep) {
              return yield* Effect.fail("Replicache is not initialized.");
            }
            // Create a non-nullable constant
            const replicacheInstance = rep;

            if (!userId) {
              return yield* Effect.fail("User not authenticated.");
            }
            yield* clientLog(
              "info",
              `Creating new note for user ${userId}...`,
              userId,
              "NotesList:createNote",
            );

            const newNoteId = crypto.randomUUID();

            yield* Effect.promise(() =>
              // Use the new constant here
              replicacheInstance.mutate.createNote({
                id: newNoteId as NoteId,
                title: "Untitled Note",
                content: "",
                user_id: userId,
              }),
            );

            yield* clientLog(
              "info",
              `Optimistically created note with id ${newNoteId}. Navigating...`,
              userId,
              "NotesList:createNote",
            );

            runClientUnscoped(navigate(`/notes/${newNoteId}`));
          }),
          Effect.catchAll((error) =>
            pipe(
              clientLog(
                "error",
                `Failed to create note: ${error}`,
                userId,
                "NotesList:createNote",
              ),
              Effect.andThen(
                Ref.set(modelRef, {
                  ...currentModel,
                  isCreating: false,
                  error: String(error),
                }),
              ),
            ),
          ),
        );
        yield* Effect.fork(createEffect);
        break;
      }
      case "SORT_NOTES_AZ": {
        const sortedNotes = [...currentModel.notes].sort((a, b) =>
          a.title.localeCompare(b.title),
        );
        yield* clientLog(
          "debug",
          "Sorting notes A-Z",
          userId,
          "NotesList:handleAction",
        );
        yield* Ref.set(modelRef, { ...currentModel, notes: sortedNotes });
        break;
      }
    }
  });
