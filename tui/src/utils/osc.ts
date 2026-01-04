/**
 * OSC escape sequence utilities for terminal integration.
 */

/**
 * Detect if running inside tmux.
 */
export function detectTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Copy text to clipboard using OSC 52 escape sequence.
 * Works in terminals that support OSC 52 (most modern terminals).
 */
export function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text).toString("base64");
  // OSC 52: \x1b]52;c;{base64}\x07
  const seq = `\x1b]52;c;${b64}\x07`;
  process.stdout.write(seq);
}

/**
 * Copy text to clipboard with tmux passthrough.
 * Required when running inside tmux to bypass its sequence filtering.
 */
export function copyToClipboardTmux(text: string): void {
  const b64 = Buffer.from(text).toString("base64");
  // Wrap in tmux passthrough: \x1bPtmux;\x1b\x1b]52;c;{base64}\x07\x1b\\
  const seq = `\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`;
  process.stdout.write(seq);
}

/**
 * Copy text to clipboard, auto-detecting tmux.
 */
export function copyToClipboardAuto(text: string): void {
  if (detectTmux()) {
    copyToClipboardTmux(text);
  } else {
    copyToClipboard(text);
  }
}

/**
 * Set terminal title using OSC 0 or OSC 2.
 */
export function setTerminalTitle(title: string): void {
  // OSC 2: \x1b]2;{title}\x07
  process.stdout.write(`\x1b]2;${title}\x07`);
}
