import type { SASTFinding } from "../tools/sast-scanner.js";

export interface CodeRef {
  filepath: string;
  lines: string;
  content: string;
}

export interface Finding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  complianceRefs: string[];
  evidence: {
    codeRefs: CodeRef[];
    links: string[];
    scanResults?: SASTFinding[];
  };
}

export interface ProductionalizeSubtask {
  id: string;
  category: string;
  query: string;
  source: "code" | "web" | "scan";
  status: "pending" | "complete";
  findings?: Finding[];
  result?: string;
}

export interface TaskmasterTask {
  id: number;
  title: string;
  description: string;
  status: "pending";
  priority: "high" | "medium" | "low";
  dependencies: number[];
  details: string;
  effort: "1-2h" | "4-8h" | "16h+";
  acceptanceCriteria: string[];
  dependencyRationale: string;
  testStrategy: string;
  subtasks: TaskmasterTask[];
}

