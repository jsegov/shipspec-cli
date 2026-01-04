interface ConnectWizardProps {
  step: "openrouter" | "tavily";
}

export function ConnectWizard(props: ConnectWizardProps) {
  const title = props.step === "openrouter" ? "OpenRouter API Key" : "Tavily API Key (Optional)";
  const hint =
    props.step === "openrouter"
      ? "Paste your OpenRouter key. Input is masked."
      : "Paste your Tavily key or leave blank to skip.";

  return (
    <box
      position="absolute"
      top="20%"
      left="10%"
      width="80%"
      height={7}
      border
      borderColor="#334155"
      backgroundColor="#0f172a"
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <text fg="#38bdf8">/connect</text>
      <text fg="#e2e8f0">{title}</text>
      <text fg="#94a3b8">{hint}</text>
      <text fg="#64748b">Press Enter to continue</text>
    </box>
  );
}
