// The sample app's "test suite": assert something, then write the artifact the pipeline publishes.
import { writeFileSync } from 'node:fs';

const sum = [1, 2, 3].reduce((a, b) => a + b, 0);
if (sum !== 6) {
  console.error(`expected 6, got ${sum}`);
  process.exit(1);
}
writeFileSync('result.json', `${JSON.stringify({ sum, ok: true })}\n`);
console.log('sample app tests passed');
