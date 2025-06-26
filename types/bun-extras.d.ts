declare namespace Bun {
  /**
   * Array of command line arguments passed to the script.
   * Equivalent to process.argv in Node.
   */
  const argv: string[];

  /**
   * Terminates the current Bun process with the given exit code.
   */
  function exit(code?: number): never;
}
