// FILE: lib/client/LocationService.ts
import { Context, Effect, Layer, Stream, Chunk } from "effect";
import { clientLog } from "./logger.client";
import { runClientUnscoped } from "./runtime";

/**
 * 1. The Interface: Defines the "shape" of our service.
 * This is a plain TypeScript interface.
 */
export interface ILocationService {
  readonly pathname: Stream.Stream<string>;
  readonly navigate: (path: string) => Effect.Effect<void>;
}

/**
 * 2. The Tag: This is the key we use for dependency injection.
 * It uses the interface `ILocationService` as its service type.
 */
export class LocationService extends Context.Tag("app/LocationService")<
  LocationService,
  ILocationService // <-- It provides a service of shape ILocationService
>() {}

/**
 * 3. The Live Layer: This provides the concrete implementation of the service.
 * We use `Layer.sync` to create a new instance of the service when the layer is built.
 */
export const LocationLive: Layer.Layer<LocationService> = Layer.sync(
  LocationService,
  () => {
    // This object is the concrete implementation of ILocationService
    const implementation: ILocationService = {
      pathname: Stream.async<string>((emit) => {
        // --- START OF FIX ---
        // Void the promise returned by `emit` to fix floating promise errors.
        const emitPath = () =>
          void emit(Effect.succeed(Chunk.of(window.location.pathname)));

        const locationChangedHandler = () => {
          // Fix latent bug: clientLog returns an Effect and must be executed.
          runClientUnscoped(
            clientLog(
              "debug",
              "Received custom 'location-changed' event.",
              undefined,
              "LocationService",
            ),
          );
          emitPath();
        };
        // --- END OF FIX ---

        window.addEventListener("popstate", emitPath);
        window.addEventListener("location-changed", locationChangedHandler);

        emitPath(); // Emit the initial path on subscription.

        return Effect.sync(() => {
          window.removeEventListener("popstate", emitPath);
          window.removeEventListener(
            "location-changed",
            locationChangedHandler,
          );
        });
      }).pipe(Stream.changes),

      navigate: (path: string) =>
        Effect.sync(() => {
          if (window.location.pathname === path) {
            return; // Don't navigate if we're already there.
          }
          const doNavigation = () => {
            window.history.pushState({}, "", path);
            window.dispatchEvent(new CustomEvent("location-changed"));
          };
          // Use the View Transitions API if the browser supports it
          if (document.startViewTransition) {
            document.startViewTransition(doNavigation);
          } else {
            doNavigation();
          }
        }),
    };
    return implementation;
  },
);
