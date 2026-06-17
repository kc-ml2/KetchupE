export interface DocumentData {
  id: string;
  content: string;
  embedding: number[];
  metadata?: any;
}

export interface TableRow {
  id: string;
  content: string;
  vector: number[];
  metadata: string;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: any;
  score?: number;
}
