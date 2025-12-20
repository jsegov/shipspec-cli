import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */
export const logger = {
  info: (msg: string) => { console.error(chalk.blue(`[INFO] ${msg}`)); },
  warn: (msg: string) => { console.error(chalk.yellow(`[WARN] ${msg}`)); },
  error: (msg: string) => { console.error(chalk.red(`[ERROR] ${msg}`)); },
  debug: (msg: string, verbose = false) => {
    if (verbose) console.error(chalk.gray(`[DEBUG] ${msg}`));
  },
  success: (msg: string) => { console.error(chalk.green(`[SUCCESS] ${msg}`)); },
  progress: (msg: string) => { console.error(chalk.cyan(msg)); },
  plain: (msg: string) => { console.error(msg); },
  output: (msg: string) => { console.log(msg); },
};
