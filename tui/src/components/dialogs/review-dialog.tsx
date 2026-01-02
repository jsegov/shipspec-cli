interface ReviewDialogProps {
  docType: "prd" | "spec" | "report";
  content: string;
  instructions?: string;
}

export function ReviewDialog(props: ReviewDialogProps) {
  const title =
    props.docType === "prd"
      ? "PRD Review"
      : props.docType === "spec"
        ? "Tech Spec Review"
        : "Report Review";

  return (
    <box
      position="absolute"
      top="5%"
      left="6%"
      width="88%"
      height="80%"
      border
      borderColor="#334155"
      backgroundColor="#0b1220"
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <text fg="#38bdf8">{title}</text>
      <scrollbox flexGrow={1} padding={1} backgroundColor="#0f172a">
        <text fg="#e2e8f0" wrapMode="word">
          {props.content}
        </text>
      </scrollbox>
      <text fg="#94a3b8">
        {props.instructions ?? "Type 'approve' or provide feedback to continue."}
      </text>
    </box>
  );
}
