// components/pages/notes/list/actions.ts
import { Effect, pipe, Ref } from "effect";
import { trpc } from "../../../../lib/client/trpc";
import { rep } from "../../../../lib/client/replicache";
import { navigate } from "../../../../lib/client/router";
import { clientLog } from "../../../../lib/client/logger.client";
import type { Action, Model } from "./types";

export const handleAction = (
  action: Action,
  modelRef: Ref.Ref<Model>,
  propose: (action: Action) => void,
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
          Effect.tryPromise({
            try: () =>
              trpc.note.create.mutate({
                title: "Untitled Note",
                content: "",
              }),
            catch: (e) => e as Error,
          }),
          Effect.flatMap((note) =>
            note && typeof note === "object" && "id" in note
              ? Effect.succeed(note)
              : Effect.fail(new Error("Server did not return a note.")),
          ),
          Effect.match({
            onSuccess: (note) =>
              propose({ type: "CREATE_NOTE_SUCCESS", payload: note }),
            onFailure: (e) =>
              propose({ type: "CREATE_NOTE_ERROR", payload: e.message }),
          }),
        );
        yield* Effect.fork(createEffect);
        break;
      }
      case "CREATE_NOTE_SUCCESS":
        yield* Ref.set(modelRef, { ...currentModel, isCreating: false });
        yield* Effect.promise(() => rep.pull());
        yield* clientLog(
          "info",
          `Note created. Navigating to /notes/${action.payload.id}`,
          undefined,
          "NotesView:handleAction",
        );
        navigate(`/notes/${action.payload.id}`);
        break;
      case "CREATE_NOTE_ERROR":
        yield* Ref.set(modelRef, {
          ...currentModel,
          isCreating: false,
          error: action.payload,
        });
        break;
      case "SORT_NOTES_AZ": {
        const sortedNotes = [...currentModel.notes].sort((a, b) =>
          a.title.localeCompare(b.title),
        );
        yield* Ref.set(modelRef, { ...currentModel, notes: sortedNotes });
        break;
      }
    }
  });
