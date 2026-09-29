import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function validMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => v !== null && !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)))
        throw new Error('metadata must contain only finite numbers, strings, booleans, or null.');
}
function blocks(text) {
    const result = [];
    let heading = '';
    const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
    for (const match of text.matchAll(pattern)) {
        const raw = match[0].trim();
        if (!raw)
            continue;
        const head = raw.match(/^#{1,6}\s+(.+)/);
        if (head)
            heading = head[1].trim();
        result.push({ text: raw, start: match.index, end: match.index + match[0].length, heading });
    }
    return result;
}
/** Paragraph-aware chunks. Long paragraphs are sliced; offsets always refer to original UTF-16 text. */
export function chunkText(text, size = 1800) {
    if (!Number.isSafeInteger(size) || size < 200 || size > 20000)
        throw new Error('chunk size must be 200..20000 characters.');
    const pieces = blocks(text);
    const out = [];
    let group = [];
    const flush = () => { if (group.length) {
        const first = group[0], last = group.at(-1);
        out.push({ text: text.slice(first.start, last.end).trim(), start: first.start, end: last.end, heading: first.heading });
        group = [];
    } };
    for (const piece of pieces) {
        if (piece.end - piece.start > size) {
            flush();
            for (let start = piece.start; start < piece.end; start += size) {
                const end = Math.min(start + size, piece.end);
                out.push({ text: text.slice(start, end), start, end, heading: piece.heading });
            }
        }
        else {
            if (group.length && piece.end - group[0].start > size)
                flush();
            group.push(piece);
        }
    }
    flush();
    return out;
}
/** Local, portable JSON corpus. A JevOne instance is required for semantic retrieval. */
export class JevRetrieval {
    jev;
    file;
    chunkSize;
    constructor(jev, file, chunkSize = 1800) {
        this.jev = jev;
        this.file = file;
        this.chunkSize = chunkSize;
    }
    async load() {
        try {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.documents))
                throw new Error('Unsupported or damaged retrieval store.');
            return parsed;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { version: 1, documents: [] };
            throw error;
        }
    }
    async save(store) {
        await mkdir(resolve(this.file, '..'), { recursive: true });
        const temporary = `${this.file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(store), 'utf8');
        await rename(temporary, this.file);
    }
    async import(document) {
        if (!document.id?.trim() || !document.source?.trim() || !document.text?.trim())
            throw new Error('id, source, and nonempty text are required.');
        validMetadata(document.metadata ?? {});
        const store = await this.load();
        const digest = hash(JSON.stringify([document.text, document.source, document.title, document.metadata]));
        const previous = store.documents.find(item => item.id === document.id);
        if (previous?.hash === digest)
            return { documentId: document.id, chunks: previous.chunks.length, changed: false };
        const title = document.title || basename(document.source);
        const chunks = chunkText(document.text, this.chunkSize).map((piece, chunkIndex) => ({
            id: `${document.id}:${chunkIndex}`, documentId: document.id, text: piece.text,
            metadata: { ...(document.metadata ?? {}), source: document.source, title, chunkIndex, start: piece.start, end: piece.end, heading: piece.heading },
        }));
        store.documents = store.documents.filter(item => item.id !== document.id);
        store.documents.push({ id: document.id, source: document.source, title, metadata: document.metadata ?? {}, hash: digest, chunks });
        await this.save(store);
        return { documentId: document.id, chunks: chunks.length, changed: true };
    }
    async importFile(path, metadata = {}) {
        if (!['.txt', '.md', '.mdx', '.json', '.csv', '.log'].includes(extname(path).toLowerCase()))
            throw new Error('Unsupported file extension. Supply extracted text through import().');
        const source = resolve(path);
        return this.import({ id: source, source, text: await readFile(source, 'utf8'), metadata });
    }
    async importDirectory(root, options = {}) {
        const maxFiles = options.maxFiles ?? 1000;
        if (!Number.isSafeInteger(maxFiles) || maxFiles < 1)
            throw new Error('maxFiles must be positive.');
        let files = 0, chunks = 0;
        const visit = async (dir) => {
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                if (entry.isSymbolicLink() || entry.name.startsWith('.'))
                    continue;
                const path = join(dir, entry.name);
                if (entry.isDirectory())
                    await visit(path);
                else if (entry.isFile() && ['.txt', '.md', '.mdx', '.json', '.csv', '.log'].includes(extname(path).toLowerCase())) {
                    if (++files > maxFiles)
                        throw new Error('maxFiles exceeded.');
                    chunks += (await this.importFile(path, options.metadata)).chunks;
                }
            }
        };
        await visit(resolve(root));
        return { files, chunks };
    }
    async list() {
        return (await this.load()).documents.map(({ id, source, title, chunks, metadata }) => ({ id, source, title, chunks: chunks.length, metadata }));
    }
    async remove(id) {
        const store = await this.load();
        const length = store.documents.length;
        store.documents = store.documents.filter(item => item.id !== id);
        if (store.documents.length !== length)
            await this.save(store);
        return store.documents.length !== length;
    }
    async retrieve(query, options = {}) {
        if (!query.trim())
            throw new Error('query must be nonempty.');
        const eligible = (await this.load()).documents.flatMap(document => document.chunks).filter(chunk => !options.filter || options.filter(chunk.metadata));
        if (!eligible.length)
            return { items: [], minimumMet: (options.minItems ?? 0) === 0, reason: 'source_exhausted', eligibleCount: 0, pagesFetched: 0, decisions: 0 };
        const pageSize = options.pageSize ?? 10;
        const result = await this.jev.recommend({
            items: eligible, context: `Retrieval query: ${query}\nSelect only passages useful as evidence for the query. Browse pages for a better passage. Do not infer facts absent from the text.`,
            preferences: 'Return source passages, not answers. Favor precise evidence over topical similarity.',
            describe: chunk => ({ id: chunk.id, label: `${chunk.metadata.title} — ${chunk.metadata.heading || `part ${chunk.metadata.chunkIndex + 1}`}`,
                description: `Source: ${chunk.metadata.source}; passage: ${chunk.text}` }),
            minItems: options.minItems ?? 1, maxItems: options.maxItems ?? 5, pageSize,
            maxPages: options.maxPages ?? Math.min(1000, Math.ceil(eligible.length / pageSize)),
            maxDecisions: options.maxDecisions ?? Math.min(10000, Math.max(40, eligible.length * 2)), ...(options.signal ? { signal: options.signal } : {}),
        });
        return { items: result.items, minimumMet: result.minimumMet, reason: result.reason,
            eligibleCount: eligible.length, pagesFetched: result.pagesFetched, decisions: result.decisions.length };
    }
}
