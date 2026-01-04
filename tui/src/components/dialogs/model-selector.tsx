interface ModelSelectorProps {
  models: { alias: string; name: string }[];
}

export function ModelSelector(props: ModelSelectorProps) {
  return (
    <box
      position="absolute"
      top="15%"
      left="8%"
      width="84%"
      height={9}
      border
      borderColor="#334155"
      backgroundColor="#0f172a"
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <text fg="#38bdf8">/model</text>
      <text fg="#e2e8f0">Available models (type alias to set):</text>
      <box flexDirection="column" gap={0}>
        {props.models.map((model) => (
          <text fg="#94a3b8">{`${model.alias} -> ${model.name}`}</text>
        ))}
      </box>
      <text fg="#64748b">Press Enter after typing an alias</text>
    </box>
  );
}
