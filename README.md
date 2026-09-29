# Jev RAG

Local, vectorless retrieval for Node.js, with [jev-one](https://github.com/thezem/jev-one) making the semantic choices.

Jev RAG imports source text, splits long documents into attributable passages, stores them in an inspectable JSON file, and lets Jev browse pages of candidates for a query. It returns **evidence**, not a generated answer. There are no embeddings, vector services, database servers, or general-purpose LLM calls in the retrieval path.

This is a separate package. It uses jev-one through its public API and does not require changes to that library. The first intended use is agent memory, but the document model works for notes, runbooks, articles, reports, and other text.

## Requirements and installation

- Node.js 22 or newer.
- A server-side `AI_GATEWAY_API_KEY` for Jev through Vercel AI Gateway.
- A built copy of `jev-one` 0.3.0 or newer. Jev RAG declares it as a peer dependency; it does not bundle it.

From sibling source checkouts:

```sh
git clone https://github.com/thezem/jev-one.git
git clone https://github.com/thezem/jev-rag.git
cd jev-one
npm ci
npm run build
cd ../jev-rag
npm install ../jev-one
```

The jev-one repository currently needs to be built before consuming its local package. In another project, install both packages from their built paths or tarballs. Keep the Gateway key out of source files and browser bundles.

## Quick start

```js
import { JevOne, PointKernel } from 'jev-one';
import { VercelJevProvider } from 'jev-one/gateway';
import { JevRetrieval } from 'jev-rag';

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is required');

const jev = new JevOne(new PointKernel(new VercelJevProvider({ apiKey })));
const rag = new JevRetrieval(jev, './data/corpus.json', 1800);

await rag.import({
  id: 'incident-42',
  source: 'https://example.org/incidents/42',
  title: 'Incident 42',
  text: 'The database was restored from the 02:00 snapshot. The team then replayed the event log.',
  metadata: { collection: 'incidents', project: 'alpha', year: 2026 },
});

const result = await rag.retrieve('How was the database restored?', {
  minItems: 1,
  maxItems: 3,
  filter: metadata => metadata.collection === 'incidents',
});
for (const item of result.items) {
  console.log(item.text);
  console.log(item.metadata.source, item.metadata.start, item.metadata.end);
}
console.log(result.minimumMet, result.reason);
```

`jev-rag` is an ESM package. The corpus file is created on the first import.

## Ingestion

| Method | Use |
| --- | --- |
| `import({ id, source, text, title?, metadata? })` | Import text from any application or extractor. Reusing an ID replaces its previous chunks; unchanged content is skipped. |
| `importFile(path, metadata?)` | Read one UTF-8 `.txt`, `.md`, `.mdx`, `.json`, `.csv`, or `.log` file. Its absolute path becomes its ID and source. |
| `importDirectory(root, { metadata?, maxFiles? })` | Walk supported files recursively. Hidden entries and symlinks are skipped. `maxFiles` defaults to 1,000. |
| `list()` | Inspect documents and chunk counts. |
| `remove(id)` | Remove a document and all its chunks. Returns whether it existed. |

For PDFs, web pages, email, or other formats, extract readable text in your application and pass it to `import`. Jev RAG does not fetch URLs or silently convert binary files. Caller metadata is a flat object of strings, finite numbers, booleans, or `null`.

Chunking is paragraph aware and carries the nearest Markdown heading. Oversized paragraphs are sliced. Every chunk records `source`, `title`, `chunkIndex`, `heading`, and `start`/`end` offsets into the original text. Offsets are JavaScript UTF-16 indices. These fields are supplied by the importer alongside caller metadata.

## Retrieval contract

```js
const result = await rag.retrieve('query', {
  minItems: 1,       // default 1
  maxItems: 5,       // default 5
  pageSize: 10,      // candidates per Jev page
  maxPages: 8,       // optional browsing cap
  maxDecisions: 40,  // optional Jev decision cap
  filter: metadata => metadata.project === 'alpha',
  signal: abortController.signal,
});
```

When omitted, page and decision budgets are derived from the eligible corpus, still capped at 1,000 pages and 10,000 decisions. Page size is constrained by jev-one's choice limit. Hard metadata filters are applied before Jev sees candidates and are never relaxed to fill a quota.

| Result field | Meaning |
| --- | --- |
| `items` | Selected passages, each with `id`, `documentId`, verbatim `text`, and metadata. |
| `minimumMet` | Whether at least `minItems` passages were returned. This checks count, not relevance. |
| `reason` | Stop reason: `max_items`, `finished`, `source_exhausted`, `max_pages`, `max_decisions`, or `aborted`. |
| `eligibleCount` | Chunks remaining after filtering. |
| `pagesFetched`, `decisions` | How much of the search Jev explored. |

Jev RAG uses jev-one's paged `recommend` operation. A page presents passages plus navigation and finish choices. Jev can move to later pages; the result records how far it got. With no lexical prefilter, a passage whose wording differs from the query remains reachable within the budgets. This can cost many Jev calls on a large corpus. See the [design note](docs/DESIGN.md) for the rationale and future scaling options.

## Live verification

With jev-one installed and `AI_GATEWAY_API_KEY` set:

```sh
npm run e2e
```

`examples/basic.js` checks a selection among three unrelated documents. `examples/paged.js` places the target on page three and checks long-document offsets, a metadata filter, document replacement, and removal. Both create temporary corpora and print their locations for inspection. They make paid Gateway calls and are not model-quality benchmarks.

## Current limits

- The JSON store assumes a single writer. Coordinate writes or add a transactional store before using it from multiple processes.
- Retrieval loads the corpus into memory. This version suits small to medium collections; large collections need partitioned storage and controlled candidate navigation.
- Directory import reads supported files as UTF-8 text. Set appropriate roots and `maxFiles` for material you do not control.
- Jev selects from supplied candidates. Meeting the requested minimum does not prove that each passage answers the query. Inspect the original source text for consequential uses.

## License

MIT. See [LICENSE](LICENSE).
