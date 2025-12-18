export interface CodeChunk {
  id: string;
  content: string;
  filepath: string;
  startLine: number;
  endLine: number;
  language: string;
  type: string;
  symbolName?: string;
}
