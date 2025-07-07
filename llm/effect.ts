// ======================================================
// Combined Effect-TS Examples
// This file illustrates many core concepts:
//   • Basic Effects (succeed, fail, sync, tryPromise)
//   • Synchronous & Asynchronous computations
//   • Combinators and pipelines (map, flatMap, tap, andThen, pipe)
//   • Error handling (catchAll, die, retry)
//   • Option operations (fromNullable, mapping, reducing)
//   • Dependency injection with Context and Services
//   • Concurrency (Effect.all with concurrency)
//   • Pattern matching with Match
//   • Execution and testing with runPromise and runPromiseExit
//   • Additional examples: Console logging, sleep/timeout, layering with Users/Todos services
// ======================================================

import type { HttpClientError } from "@effect/platform";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { Schema } from "@effect/schema";
import type { Cause } from "effect";
import {
  Console,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  pipe,
  Schedule,
  Stream,
} from "effect";
import * as Exit from "effect/Exit";
import * as Match from "effect/Match";

// ======================================================
// 1. Basic Effects Creation
// ------------------------------------------------------
// Create a successful effect and a failing effect
const _succeedEffect = Effect.succeed(5);
const _failEffect = Effect.fail(3);

// Asynchronous effect example: simulate S3 file upload
// (S3Client and PutObjectCommand are simplified stubs)
type S3Client = { send: (command: any) => Promise<any> };
class PutObjectCommand {
  constructor(public params: { Bucket: string; Key: string; Body: any }) {}
}
const _uploadFileToS3 = (
  s3Client: S3Client,
  bucketName: string,
  key: string,
  body: any,
) =>
  Effect.tryPromise({
    try: () =>
      s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
        }),
      ),
    catch: (error: any) =>
      new Error(
        `Error uploading file to S3 bucket - ${bucketName}: ${error.message}`,
      ),
  });

// ======================================================
// 2. Synchronous Computations & Error Handling
// ------------------------------------------------------

// Synchronous computation using Effect.sync
const generateRandomNumber = Effect.sync(() => Math.random());
const randomValue = Effect.runSync(generateRandomNumber);
Effect.runSync(Console.log("Random value:", randomValue));

// Synchronous function that may fail with Effect.try
const parseJson = (jsonString: string): Effect.Effect<any, Error, never> =>
  Effect.try({
    try: () => JSON.parse(jsonString),
    catch: (error) =>
      new Error(`Failed to parse JSON: ${(error as Error).message}`),
  });

try {
  const parsed = Effect.runSync(parseJson('{"name": "Alice", "age": 30}'));
  Effect.runSync(Console.log("Parsed JSON:", parsed));
} catch (error) {
  Effect.runSync(Console.error("Sync error caught:", error));
}

// Asynchronous effect using Effect.tryPromise (dummy login API)
const loginAction = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<{ token: string }> => {
  // Log using an effect and wait for it
  await Effect.runPromise(
    Console.log("Calling login API with:", email, password),
  );
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (email === "test@example.com" && password === "password") {
        resolve({ token: "dummy-token" });
      } else {
        reject(new Error("Invalid credentials"));
      }
    }, 1000);
  });
};

// Dummy state with credentials
const state = {
  email: "test@example.com", // change these values to test failure
  password: "password",
};

// Dummy ActionTypes and dispatch (using effect logging in our dispatch function)
const ActionTypes = {
  AUTH_SUCCESS: "AUTH_SUCCESS",
  AUTH_FAILURE: "AUTH_FAILURE",
};
const dispatch = (action: { type: string; payload?: any }) =>
  Effect.runSync(Console.log("Dispatch:", action));

// Compose the login effect using Effect.tryPromise, tap, and catchAll
const loginEffect = pipe(
  Effect.tryPromise({
    try: () =>
      loginAction({ email: state.email, password: state.password }) ??
      Promise.reject(new Error("loginAction returned undefined")),
    catch: (reason) => reason,
  }),
  // On success, dispatch AUTH_SUCCESS and redirect.
  Effect.tap(() =>
    Effect.sync(() => {
      dispatch({ type: ActionTypes.AUTH_SUCCESS });
      Console.log("Redirecting to /admin");
    }),
  ),
  // If any error occurs, dispatch AUTH_FAILURE.
  Effect.catchAll((error) =>
    Effect.sync(() => {
      dispatch({
        type: ActionTypes.AUTH_FAILURE,
        payload: error instanceof Error ? error.message : "Login failed",
      });
    }),
  ),
);

// Run the login effect
Effect.runPromise(loginEffect)
  .then(() => Console.log("Login effect executed successfully"))
  .catch(Console.error);

// ======================================================
// 3. Using Combinators and Pipes
// ------------------------------------------------------

// Using map, flatMap, tap, andThen via pipe
const double = (n: number) => n * 2;
const increment = (n: number) => Effect.succeed(n + 1);

const combinedPipeline = pipe(
  Effect.succeed(42),
  Effect.flatMap((n) => Effect.succeed(n / 2)),
  Effect.map(double),
  Effect.tap((n) => Console.log("Double is", n)),
  Effect.andThen(increment),
  Effect.tap((n) => Console.log("Incremented value is", n)),
);
Effect.runSync(combinedPipeline);

// ======================================================
// 4. Working with Options and Collections
// ------------------------------------------------------

// Example: using Option to safely access a value
const maybeGreeting = Option.fromNullable("Hello");
const combinedOption = pipe(
  maybeGreeting,
  Option.map((val) => `${val} World`),
);
Effect.runSync(Console.log("Combined Option:", combinedOption));

// Example: reducing an array of Options (simulate O.reduceCompact)
const optionArray = [
  Option.some(1),
  Option.none(),
  Option.some(2),
  Option.some(3),
];
const sumOfOptions = optionArray.reduce(
  (acc, opt) => (Option.isSome(opt) ? acc + opt.value : acc),
  0,
);
Effect.runSync(Console.log("Sum of Options:", sumOfOptions));

// ======================================================
// 5. Expected vs Unexpected Errors and Handling
// ------------------------------------------------------

// Example: function that may fail based on input
const mightFail = (input: number): Effect.Effect<number, string, never> =>
  input < 0 ? Effect.fail("Negative input!") : Effect.succeed(input * 2);

// Handling the error by recovering to a default number.
const handledEffect = pipe(
  mightFail(-5),
  Effect.catchAll((error: string) =>
    Effect.sync(() => {
      Console.error("Caught error:", error);
      return 0;
    }),
  ),
);
Effect.runSync(Console.log("Handled result:", Effect.runSync(handledEffect)));

// Example: an unrecoverable error using die (unexpected error)
const unrecoverable = Effect.sync(() => {
  throw new Error("Unexpected failure!");
});
try {
  Effect.runSync(unrecoverable);
} catch (error) {
  Effect.runSync(Console.error("Die caught:", error));
}

// ======================================================
// 6. Dependency Injection with Context (Services)
// ------------------------------------------------------

// Define a service interface for sending greetings.
type ISendGreetings = {
  sendGreetings: (name: string) => Effect.Effect<void>;
};

// Create a tag for ISendGreetings using a literal key.
const SendGreetings = Context.GenericTag<ISendGreetings>("SendGreetings");

// Provide an implementation for the service.
const sendGreetingsImpl: ISendGreetings = {
  sendGreetings: (name: string) =>
    Effect.sync(() => {
      Console.log("Greetings sent:", name);
    }),
};

// A simple effect to generate a greeting.
const helloEffect = (name?: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    return `Hello, ${name || "world"}!`;
  });

// An effect that uses dependency injection to send greetings.
const sayHello: Effect.Effect<void, never, ISendGreetings> = Effect.gen(
  function* () {
    const sender = yield* SendGreetings;
    const greeting = yield* helloEffect("world");
    yield* sender.sendGreetings(greeting);
  },
);

// Run the effect by providing the dependency.
Effect.runPromise(
  pipe(sayHello, Effect.provideService(SendGreetings, sendGreetingsImpl)),
).then(() => Console.log("Dependency injection example complete"));

// ======================================================
// 7. Concurrency, Logging, and Retry
// ------------------------------------------------------

// Simulate two asynchronous tasks (e.g. loading matches and calendar events)
const loadMatches = (_teamId: number) =>
  Effect.tryPromise({
    try: () =>
      new Promise<number[]>((resolve) =>
        setTimeout(() => resolve([1, 2, 3]), 1000),
      ),
    catch: (_e) => new Error("loadMatches failed"),
  });
const loadCalendarEvents = (_teamId: number) =>
  Effect.tryPromise({
    try: () =>
      new Promise<number[]>((resolve) =>
        setTimeout(() => resolve([4, 5]), 1200),
      ),
    catch: (_e) => new Error("loadCalendarEvents failed"),
  });

const teamId = 1;
const concurrentEffect = pipe(
  Effect.all(
    {
      matches: loadMatches(teamId),
      calendarEvents: loadCalendarEvents(teamId),
    },
    { concurrency: 2 },
  ),
  Effect.tap((result) =>
    Effect.sync(() => {
      Console.log("Concurrent tasks result:", result);
    }),
  ),
);

Effect.runPromise(concurrentEffect)
  .then(() => Console.log("Concurrent example complete"))
  .catch(Console.error);

// Retry example: a flaky operation that succeeds after a few attempts
let attempt = 0;
const flakyOperation = () =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        attempt++;
        if (attempt < 3) {
          reject(new Error("Transient error"));
        } else {
          resolve("Success after retry");
        }
      }),
    catch: (e) => new Error((e as Error).message),
  });

const retryEffect = Effect.retry(flakyOperation(), { times: 5 });
Effect.runPromise(retryEffect)
  .then((result) => Console.log("Retry succeeded with:", result))
  .catch(Console.error);

// ======================================================
// 8. Pattern Matching with Match Module
// ------------------------------------------------------

// Define a discriminated union for events.
type Event =
  | { _tag: "fetch" }
  | { _tag: "success"; data: string }
  | { _tag: "error"; error: Error }
  | { _tag: "cancel" };

// Create a matcher for Event using Match.type and pipe.
// The matcher handles:
//   - both "fetch" and "success" as the same case,
//   - "error" by extracting the error message,
//   - "cancel" with a specific handler.
const matchEvent = pipe(
  Match.type<Event>(),
  // Match when _tag is "fetch" or "success"
  Match.tag("fetch", "success", () => "Ok!"),
  // Match when _tag is "error"
  Match.tag("error", (event) => `Error: ${event.error.message}`),
  // Match when _tag is "cancel"
  Match.tag("cancel", () => "Cancelled"),
  // Ensure that all cases are handled.
  Match.exhaustive,
);

Effect.runSync(Console.log(matchEvent({ _tag: "success", data: "Hello" }))); // "Ok!"
Effect.runSync(
  Console.log(matchEvent({ _tag: "error", error: new Error("Oops!") })),
); // "Error: Oops!"
Effect.runSync(Console.log(matchEvent({ _tag: "cancel" }))); // "Cancelled"

// ======================================================
// 9. Execution and Testing of Effects
// ------------------------------------------------------

// Example: Using runPromiseExit to test an effect
const testEffect = Effect.succeed("Test success");
Effect.runPromiseExit(testEffect)
  .then((exit) => {
    if (Exit.isSuccess(exit)) Console.log("Test succeeded:", exit.value);
    else Console.error("Test failed:", exit);
  })
  .catch(Console.error);

// ======================================================
// 10. Basic Console Logging (Additional Example)
// ------------------------------------------------------
const mainConsole = Console.log("Hello, World!");
Effect.runSync(mainConsole);

// ======================================================
// 11. Sleep, Logging, and Timeout Failure (Additional Example)
// ------------------------------------------------------
const mainSleep = Effect.sleep(1000).pipe(
  Effect.andThen(() => Console.log("Hello")),
  Effect.timeoutFail({
    duration: 500,
    onTimeout: () => "Aborted!",
  }),
);

Effect.runPromise(mainSleep)
  .then((result) => Console.log("Final result:", result))
  .catch(Console.error);

// ======================================================
// 12. Concurrency Example: Fetching Users (Additional Example)
// ------------------------------------------------------
declare const getUser: (id: number) => Effect.Effect<unknown, Error>;
const ids = Array.from({ length: 10 }, (_, i) => i);

const mainUsers = Effect.forEach(ids, (id) => getUser(id), {
  concurrency: 3,
}).pipe(Effect.andThen((users) => Console.log("Got users", users)));

Effect.runPromise(mainUsers)
  .then(() => Console.log("Concurrency example complete"))
  .catch(Console.error);

// ======================================================
// 13. Todos Service with Dynamic Import and Concurrency (Additional Example)
// ------------------------------------------------------
const makeTodos = Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com"),
    ),
  );

  const findById = (
    id: number,
  ): Effect.Effect<
    unknown,
    HttpClientError.HttpClientError | Cause.TimeoutException
  > =>
    client.get(`/todos/${id}`).pipe(
      Effect.andThen((response) => response.json),
      Effect.scoped,
      Effect.timeout("1 second"),
    );

  const list = (
    ids: Iterable<number>,
  ): Effect.Effect<
    Array<unknown>,
    HttpClientError.HttpClientError | Cause.TimeoutException
  > =>
    Effect.forEach(ids, (id) => findById(id).pipe(Effect.retry({ times: 3 })), {
      concurrency: "inherit",
    });

  return { list, findById } as const;
});

class Todos extends Effect.Tag("Todos")<
  Todos,
  Effect.Effect.Success<typeof makeTodos>
>() {
  static Live = Layer.effect(Todos, makeTodos).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}

(async () => {
  // Dynamically import the Array module from Effect

  const _mainTodos = Todos.list(ids).pipe(
    Effect.withConcurrency(3),
    Effect.timeout("10 seconds"),
    Effect.andThen((todos) => Console.log("Got todos", todos)),
  );
})();

// ======================================================
// 14. Schema Validation Example (Zod Replacement)
// ======================================================
const User = Schema.Struct({
  username: Schema.String,
});

// Instead of using zod’s .parse, we use Schema.decodeUnknownSync
const decodedUser = Schema.decodeUnknownSync(User)({
  username: "john_doe",
});

// Extract the inferred type
type _NewUser = Schema.Schema.Type<typeof User>;

Console.log("Decoded user:", decodedUser);

// ======================================================
// 15. RXJS Streaming Replacement Example
// ======================================================
const counts = Stream.fromSchedule(Schedule.spaced(1000)).pipe(
  Stream.take(5),
  Stream.map((x) => x * 2),
  Stream.runCollect,
);

Effect.runPromise(counts).then((result) =>
  Console.log("Stream counts:", result),
);

// ======================================================
// 16. Advanced Error Modeling and Handling
// ======================================================

// Define custom error types using type aliases
export type TFooError = {
  readonly _tag: "FooError";
  readonly message: string;
};
export const FooError = Data.tagged<TFooError>("FooError");

export type TBarError = {
  readonly _tag: "BarError";
  readonly message: string;
};
// Renamed to avoid redeclaration with the type
export const createBarError = (message: string): TBarError => ({
  _tag: "BarError",
  message,
});

// Create an effect that fails with either error based on randomness
const exampleEffect = Effect.if(Math.random() > 0.5, {
  onTrue: () => Effect.fail(FooError({ message: "Foo occurred" })),

  onFalse: () => Effect.fail(createBarError("Bar occurred")),
});

// Recover from both errors using catchTags (formatted on one line to satisfy linting)
const handledMultiple = Effect.catchTags(exampleEffect, {
  FooError: () => Effect.succeed("Handled FooError"),
  BarError: () => Effect.succeed("Handled BarError"),
});

// Run the error handling effects

Effect.runPromise(handledMultiple)
  .then((result) => Console.log("handledMultiple result:", result))
  .catch(Console.error);

// ======================================================
// 17. Generator-Based Syntax and Do Notation
// ======================================================

// Define service tags
class CustomRandom extends Context.Tag("CustomRandom")<
  CustomRandom,
  { readonly next: () => number }
>() {}
class Foo extends Context.Tag("Foo")<Foo, { readonly foo: number }>() {}
class Bar extends Context.Tag("Bar")<Bar, { readonly bar: number }>() {}

// Generator-based effect using Effect.gen
const _generatorExample = Effect.gen(function* ($) {
  const randomService = yield* $(CustomRandom);
  const fooService = yield* $(Foo);
  const barService = yield* $(Bar);
  const randomValue = randomService.next();
  Console.log("Generator syntax:", randomValue, fooService.foo, barService.bar);
  return "generator complete" as const;
});

// Using Do Notation via pipe
const _doNotationExample = pipe(
  Effect.Do,
  Effect.bind("random", () => CustomRandom),
  Effect.bind("foo", () => Foo),
  Effect.bind("bar", () => Bar),
  Effect.flatMap(({ random, foo, bar }) =>
    Effect.sync(() => {
      Console.log("Do notation:", random.next(), foo.foo, bar.bar);
      return "do complete" as const;
    }),
  ),
);

// ======================================================
// 18. Explicit Synchronous Computation with Typed Error Handling
// ======================================================

// Define a custom error type as a subclass of Error
class RandomTooHighError extends Error {
  readonly _tag = "RandomTooHighError";
  constructor() {
    super("Random value was too high");
  }
}

/**
 * generateSafeRandom returns an Effect that:
 * - succeeds with a random number if it's at most 0.9
 * - fails with RandomTooHighError if the number is greater than 0.9
 *
 * The error channel is typed as RandomTooHighError.
 */
function generateSafeRandom(): Effect.Effect<
  number,
  RandomTooHighError,
  never
> {
  return pipe(
    Effect.sync(() => Math.random()),
    Effect.flatMap((random) =>
      random > 0.9
        ? Effect.fail(new RandomTooHighError())
        : Effect.succeed(random),
    ),
  );
}

// Recover from failure by providing a default value
const safeRandomProgram = pipe(
  generateSafeRandom(),
  Effect.catchAll(() => Effect.succeed(-1)),
);

// Running the safe random program
Effect.runPromise(safeRandomProgram)
  .then((result) => Console.log("Safe random result:", result))
  .catch(Console.error);
