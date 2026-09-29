import type { JevOne } from 'jev-one';
export type Metadata = Record<string, string | number | boolean | null>;
export interface RetrievalChunk {
    id: string;
    documentId: string;
    text: string;
    metadata: Metadata & {
        source: string;
        title: string;
        chunkIndex: number;
        start: number;
        end: number;
        heading: string;
    };
}
export interface RetrievalDocument {
    id: string;
    text: string;
    source: string;
    title?: string;
    metadata?: Metadata;
}
export interface RetrievalOptions {
    minItems?: number;
    maxItems?: number;
    pageSize?: number;
    maxPages?: number;
    maxDecisions?: number;
    filter?: (metadata: RetrievalChunk['metadata']) => boolean;
    signal?: AbortSignal;
}
export interface RetrievalResult {
    items: RetrievalChunk[];
    minimumMet: boolean;
    reason: string;
    eligibleCount: number;
    pagesFetched: number;
    decisions: number;
}
/** Paragraph-aware chunks. Long paragraphs are sliced; offsets always refer to original UTF-16 text. */
export declare function chunkText(text: string, size?: number): {
    text: string;
    start: number;
    end: number;
    heading: string;
}[];
/** Local, portable JSON corpus. A JevOne instance is required for semantic retrieval. */
export declare class JevRetrieval {
    readonly jev: JevOne;
    readonly file: string;
    readonly chunkSize: number;
    constructor(jev: JevOne, file: string, chunkSize?: number);
    private load;
    private save;
    import(document: RetrievalDocument): Promise<{
        documentId: string;
        chunks: number;
        changed: boolean;
    }>;
    importFile(path: string, metadata?: Metadata): Promise<{
        documentId: string;
        chunks: number;
        changed: boolean;
    }>;
    importDirectory(root: string, options?: {
        metadata?: Metadata;
        maxFiles?: number;
    }): Promise<{
        files: number;
        chunks: number;
    }>;
    list(): Promise<{
        id: string;
        source: string;
        title: string;
        chunks: number;
        metadata: Metadata;
    }[]>;
    remove(id: string): Promise<boolean>;
    retrieve(query: string, options?: RetrievalOptions): Promise<RetrievalResult>;
}
