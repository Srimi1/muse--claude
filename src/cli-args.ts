/**
 * Argument normalisation for the claude-muse entry point.
 * Kept in its own module so it can be tested without executing the CLI.
 * @module cli-args
 */

/** Flags handled by the top-level program rather than by a subcommand. */
const PROGRAM_FLAGS = ['--help', '-h', '--version', '-V'];

/**
 * Decides whether an implicit `launch` subcommand should be inserted.
 *
 * `claude-muse` and `claude-muse --model x` are shorthand for `launch`.
 * An unrecognised word such as `claude-muse bogus` is NOT: forwarding it to
 * launch turns an unknown-command error into a confusing complaint about
 * argument counts, so it is left for commander to reject.
 *
 * @param args - argv entries after the node binary and the script path
 * @returns true when `launch` should be spliced in as the subcommand
 */
export function shouldDefaultToLaunch(args: string[]): boolean {
  if (args.length === 0) return true;
  const first = args[0];
  if (PROGRAM_FLAGS.includes(first)) return false;
  return first.startsWith('-');
}
