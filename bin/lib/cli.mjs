// The fuobe command line: picks the command, parses its options, connects to the server and
// turns every failure into one readable line (or `{"error": …}` with --json).
import fs from "node:fs";
import { GLOBAL_OPTIONS, parseArgs, suggest, UsageError } from "./args.mjs";
import { ApiError, createClient } from "./client.mjs";
import { ALIASES, COMMANDS, EXIT } from "./commands.mjs";
import { configPath, readConfig, resolveTarget } from "./config.mjs";

export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function optionLines(options) {
  const rows = Object.entries(options).map(([name, s]) => {
    const value = s.choices ? s.choices.join("|") : (s.value ?? (s.type === "number" ? "n" : "value"));
    const flag = `${s.short ? `-${s.short}, ` : "    "}--${name}${s.type === "boolean" ? "" : ` <${value}>`}`;
    return [flag, s.describe ?? ""];
  });
  const width = Math.max(...rows.map(([f]) => f.length));
  return rows.map(([f, d]) => `  ${f.padEnd(width)}  ${d}`.trimEnd());
}

export function generalHelp() {
  const names = Object.keys(COMMANDS);
  const width = Math.max(...names.map((n) => n.length));
  return [
    `fuobe ${VERSION} — make images, video, audio and 3D with a Fuobe studio, from a terminal or an agent`,
    "",
    "Usage: fuobe <command> [options]",
    "",
    "Commands:",
    ...names.map((n) => `  ${n.padEnd(width)}  ${COMMANDS[n].summary}`),
    "",
    "Options for every command:",
    ...optionLines(GLOBAL_OPTIONS),
    "",
    "The server is FUOBE_URL, else the one `fuobe login` saved, else http://localhost:3000. With a password",
    "set on the server, the CLI needs an API token (Settings → Security → API tokens).",
    "",
    'Start with: fuobe models --kind image, then fuobe generate "a red fox in the snow" --wait',
    "More: fuobe <command> --help, and docs/cli.md",
  ].join("\n");
}

export function commandHelp(name) {
  const c = COMMANDS[name];
  return [
    `${c.summary}.`,
    "",
    `Usage: ${c.usage}`,
    ...(c.options && Object.keys(c.options).length ? ["", "Options:", ...optionLines(c.options)] : []),
    "",
    "Options for every command:",
    ...optionLines(GLOBAL_OPTIONS),
    ...(c.examples?.length ? ["", "Examples:", ...c.examples.map((e) => `  ${e}`)] : []),
  ].join("\n");
}

/**
 * Run one command line. Returns the exit code.
 * @param {string[]} argv the arguments after `fuobe`
 * @param {object} io stdout / stderr streams, env, cwd, home, fetch, and the terminal helpers (see bin/fuobe.mjs)
 */
export async function main(argv, io) {
  const print = (text) => {
    io.stdout.write(`${text}\n`);
  };
  const wantsJson = argv.includes("--json");
  const fail = (message, code, status) => {
    if (wantsJson) io.stderr.write(`${JSON.stringify({ error: message, ...(status && { status }) })}\n`);
    else io.stderr.write(`${message}\n`);
    return code;
  };

  let [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    const about = rest[0] && (ALIASES[rest[0]] ?? rest[0]);
    print(about && COMMANDS[about] ? commandHelp(about) : generalHelp());
    return EXIT.ok;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    print(VERSION);
    return EXIT.ok;
  }
  // `fuobe auth login` (another CLI's spelling) is `fuobe login`.
  if (name === "auth") name = rest.shift() ?? "status";
  name = ALIASES[name] ?? name;
  const cmd = COMMANDS[name];
  if (!cmd) {
    const near = suggest(name, Object.keys(COMMANDS));
    return fail(`Unknown command “${name}”.${near ? ` Did you mean fuobe ${near}?` : ""} Run fuobe --help for the list.`, EXIT.usage);
  }

  try {
    // A passthrough command (eval) parses its own arguments.
    const { values, positionals } = cmd.passthrough ? { values: {}, positionals: rest } : parseArgs(rest, cmd.options ?? {}, name);
    if (values.help) {
      print(commandHelp(name));
      return EXIT.ok;
    }
    // login and logout read (or replace) the saved config themselves, so a broken file doesn't stop them.
    const target = { ...resolveTarget(values, io.env, cmd.ownConfig ? {} : readConfig(configPath(io.env, io.home))), fetch: io.fetch };
    const connect = (t) => createClient({ fetch: io.fetch, ...t });
    const ctx = {
      command: name,
      values,
      positionals,
      io,
      target,
      connect,
      client: connect(target),
      print,
      note: (text) => io.stderr.write(`${text}\n`),
      /** Print the --json result; returns the success exit code so `return ctx.json(…)` ends a command. */
      json: (data) => {
        print(JSON.stringify(data, null, 2));
        return EXIT.ok;
      },
    };
    return (await cmd.run(ctx)) ?? EXIT.ok;
  } catch (e) {
    if (e instanceof UsageError) {
      const usage = e.command && COMMANDS[e.command] ? `\nUsage: ${COMMANDS[e.command].usage}  (fuobe ${e.command} --help for more)` : "";
      return fail(`${e.message}${wantsJson ? "" : usage}`, EXIT.usage);
    }
    if (e instanceof ApiError) return fail(e.message, EXIT.failed, e.status);
    if (io.env.FUOBE_DEBUG) io.stderr.write(`${e?.stack ?? e}\n`);
    return fail(e?.message ?? String(e), EXIT.failed);
  }
}
