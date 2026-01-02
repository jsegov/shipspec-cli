import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  plugins: [solidPlugin],
});

if (!result.success) {
  const message = result.logs.map((log) => log.message).join("\n");
  throw new Error(`TUI build failed:\n${message}`);
}
