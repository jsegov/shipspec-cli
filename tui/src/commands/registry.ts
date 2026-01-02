export interface SlashCommandContext {
  requestModelList: () => void;
  requestModelCurrent: () => void;
  requestModelSet: (model: string) => void;
  openModelDialog: () => void;
  openConnectDialog: () => void;
  clearHistory: () => void;
  exit: () => void;
  startProductionReview: (context?: string) => void;
  showHelp: () => void;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  run: (ctx: SlashCommandContext, args: string[]) => void;
}

export const slashCommands: SlashCommand[] = [
  {
    name: "connect",
    description: "Configure API keys",
    usage: "/connect",
    run: (ctx) => {
      ctx.openConnectDialog();
    },
  },
  {
    name: "model",
    description: "Manage chat models",
    usage: "/model [list|current|set <alias>]",
    run: (ctx, args) => {
      const [subcommand, ...rest] = args;
      if (!subcommand) {
        ctx.openModelDialog();
        return;
      }
      if (subcommand === "list") {
        ctx.requestModelList();
        return;
      }
      if (subcommand === "current") {
        ctx.requestModelCurrent();
        return;
      }
      if (subcommand === "set") {
        const model = rest.join(" ").trim();
        if (model) {
          ctx.requestModelSet(model);
        }
        return;
      }
    },
  },
  {
    name: "production-readiness-review",
    aliases: ["prr"],
    description: "Run production readiness analysis",
    usage: "/production-readiness-review [context]",
    run: (ctx, args) => {
      ctx.startProductionReview(args.join(" ").trim() || undefined);
    },
  },
  {
    name: "help",
    description: "Show available commands and keybinds",
    usage: "/help",
    run: (ctx) => {
      ctx.showHelp();
    },
  },
  {
    name: "clear",
    description: "Clear conversation history",
    usage: "/clear",
    run: (ctx) => {
      ctx.clearHistory();
    },
  },
  {
    name: "exit",
    aliases: ["quit"],
    description: "Exit the application",
    usage: "/exit",
    run: (ctx) => {
      ctx.exit();
    },
  },
];

export function findSlashCommand(input: string): { command: SlashCommand; args: string[] } | null {
  if (!input.startsWith("/")) {
    return null;
  }
  const parts = input
    .slice(1)
    .trim()
    .split(" ")
    .filter((part) => part.length > 0);
  const name = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!name) {
    return null;
  }

  const command = slashCommands.find(
    (cmd) => cmd.name === name || (cmd.aliases?.includes(name) ?? false)
  );
  if (!command) {
    return null;
  }

  return { command, args };
}
