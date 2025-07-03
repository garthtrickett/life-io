// components/pages/notes/detail/actions.ts
import { Effect, pipe, Ref, Fiber } from "effect";
import { trpc } from "../../../../lib/client/trpc";
import { NoteSaveError, type Action, type Model } from "./types";

export const handleAction = (
  action: Action,
  modelRef: Ref.Ref<Model>,
  propose: (action: Action) => void,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const currentModel = yield* Ref.get(modelRef);
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
            Effect.andThen(() => propose({ type: "SAVE_START" })),
            Effect.asVoid,
            Effect.fork,
          );
          yield* Ref.update(modelRef, (m): Model => ({ ...m, saveFiber }));
        }
        break;

      case "SAVE_START": {
        if (!currentModel.note) return;
        yield* Ref.update(modelRef, (m): Model => ({ ...m, status: "saving" }));

        const saveEffect = pipe(
          Effect.tryPromise({
            try: () =>
              trpc.note.update.mutate({
                id: currentModel.note!.id,
                title: currentModel.note!.title,
                content: currentModel.note!.content,
              }),
            catch: (err) =>
              new NoteSaveError({
                message:
                  err instanceof Error
                    ? err.message
                    : "An unknown error occurred.",
              }),
          }),
          Effect.matchEffect({
            onSuccess: () =>
              Effect.sync(() => propose({ type: "SAVE_SUCCESS" })),
            onFailure: (error) =>
              Effect.sync(() =>
                propose({ type: "SAVE_ERROR", payload: error }),
              ),
          }),
        );

        yield* Effect.fork(saveEffect);
        break;
      }

      case "SAVE_SUCCESS":
        yield* Ref.update(modelRef, (m): Model => ({ ...m, status: "idle" }));
        break;

      case "SAVE_ERROR":
        yield* Ref.update(
          modelRef,
          (m): Model => ({
            ...m,
            status: "error",
            error: action.payload.message,
          }),
        );
        break;
    }
  });
