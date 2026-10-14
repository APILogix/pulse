const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../src/modules/ai/repository.ts');
const content = fs.readFileSync(file, 'utf8');

const tables = new Set();
const matches = content.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z0-9_]+)/gi);
for (const m of matches) {
  tables.add(m[1].toLowerCase());
}
console.log('Tables used in src/modules/ai/repository.ts:', [...tables].sort());
