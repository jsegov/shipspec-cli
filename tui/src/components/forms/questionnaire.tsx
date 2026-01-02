interface QuestionnaireProps {
  title: string;
  question: string;
  progress: string;
  options?: string[];
}

export function Questionnaire(props: QuestionnaireProps) {
  return (
    <box
      position="absolute"
      top="20%"
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
      <text fg="#38bdf8">{props.title}</text>
      <text fg="#94a3b8">{props.progress}</text>
      <text fg="#e2e8f0">{props.question}</text>
      {props.options && props.options.length > 0 ? (
        <box flexDirection="column" gap={0}>
          {props.options.map((option) => (
            <text fg="#64748b">- {option}</text>
          ))}
        </box>
      ) : null}
      <text fg="#64748b">Press Enter to submit</text>
    </box>
  );
}
