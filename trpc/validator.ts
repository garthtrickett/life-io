// trpc/validator.ts
import { Schema } from "@effect/schema";
import { formatErrorSync } from "@effect/schema/TreeFormatter";
import { type ParseError } from "@effect/schema/ParseResult";
import { TRPCError } from "@trpc/server";
import { type Either } from "effect/Either";

/**
 * A Zod-like validator for tRPC that's powered by Effect Schema.
 * It provides a `_parse` method that tRPC can use for input validation.
 *
 * @param schema The Effect Schema to use for validation.
 * @returns An object that tRPC can use in its `.input()` method.
 */
export const s = <A, I>(schema: Schema.Schema<A, I, never>) => {
  const decode = Schema.decodeUnknownEither(schema);
  return {
    // This is the private-ish API that tRPC uses for parsing.
    _parse: (input: unknown): A => {
      // We run the decoding synchronously. For async validation, a different
      // approach (like a middleware) would be needed.
      const result: Either<A, ParseError> = decode(input);

      if (result._tag === "Left") {
        // If decoding fails, format the error and throw a tRPC-specific error.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: formatErrorSync(result.left),
        });
      }
      // If successful, return the parsed data.
      return result.right;
    },
    // The following properties are added to make this object resemble a Zod schema
    // for better type inference within tRPC.
    _output: undefined as A,
    _input: undefined as I,
    _def: {
      schema,
      typeName: "EffectSchema",
    },
    // Adding optional methods that might be checked by tRPC or its ecosystem.
    parse: (input: unknown): A => s(schema)._parse(input),
    safeParse: (
      input: unknown,
    ): { success: true; data: A } | { success: false; error: ParseError } => {
      const result = decode(input);
      if (result._tag === "Left") {
        return { success: false, error: result.left };
      }
      return { success: true, data: result.right };
    },
  };
};
