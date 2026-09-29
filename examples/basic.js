import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevOne, PointKernel } from 'jev-one';
import { VercelJevProvider } from 'jev-one/gateway';
import { JevRetrieval } from '../src/index.js';

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error('Set AI_GATEWAY_API_KEY.');
const directory = await mkdtemp(join(tmpdir(), 'jev-retrieval-'));
const jev = new JevOne(new PointKernel(new VercelJevProvider({ apiKey })));
const corpus = new JevRetrieval(jev, join(directory, 'corpus.json'), 500);

await corpus.import({ id: 'garden', source: 'memory://garden', title: 'Garden notes', text: 'The basil seedlings need morning sunlight and moist soil.', metadata: { project: 'home', kind: 'note' } });
await corpus.import({ id: 'release', source: 'memory://release', title: 'Release notes', text: 'Before deploying, run the browser smoke flow and check that the signup form submits.', metadata: { project: 'work', kind: 'procedure' } });
await corpus.import({ id: 'train', source: 'memory://train', title: 'Travel notes', text: 'The train leaves platform four at six in the evening.', metadata: { project: 'travel', kind: 'note' } });

const result = await corpus.retrieve('What should I check before shipping the website?', { minItems: 1, maxItems: 1, pageSize: 3 });
console.log(JSON.stringify({ directory, result }, null, 2));
if (!result.minimumMet || result.items[0]?.documentId !== 'release') throw new Error('Live retrieval missed the release procedure.');
if (result.items[0]?.metadata.project !== 'work') throw new Error('Metadata was not preserved.');
console.log('LIVE E2E PASS');
