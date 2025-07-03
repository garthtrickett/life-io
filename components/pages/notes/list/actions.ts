// components/pages/notes/list/actions.ts
import { Effect, pipe, Ref } from "effect";
import { rep } from "../../../../lib/client/replicache";
import { navigate } from "../../../../lib/client/router";
import { authState } from "../../../../lib/client/stores/authStore";
import type { Action, Model } from "./types";

export const handleAction = (
  action: Action,
  modelRef: Ref.Ref<Model>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(modelRef);
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
            const userId = authState.value.user?.id;
            if (!userId) {
              return yield* Effect.fail("User not authenticated.");
            }

            const newNoteId = crypto.randomUUID();

            // Call the Replicache mutator. This is an optimistic update.
            yield* Effect.promise(() =>
              rep.mutate.createNote({
                id: newNoteId,
                title: "Untitled Note",
                content: "",
                user_id: userId,
              }),
            );

            // Navigate immediately. The UI will update via the subscription.
            navigate(`/notes/${newNoteId}`);
          }),
          Effect.catchAll((error) =>
            Ref.set(modelRef, { ...currentModel, isCreating: false, error }),
          ),
        );
        yield* Effect.fork(createEffect);
        break;
      }
      case "SORT_NOTES_AZ": {
        const sortedNotes = [...currentModel.notes].sort((a, b) =>
          a.title.localeCompare(b.title),
        );
        yield* Ref.set(modelRef, { ...currentModel, notes: sortedNotes });
        break;
      }
    }
  });
