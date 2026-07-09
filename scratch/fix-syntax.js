import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('controller.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const controllers = walk('src/modules/billing');

for (const file of controllers) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Revert `as type ` back to `as `
  content = content.replace(/ as type /g, ' as ');
  
  // Revert `import { type type ` back to `import { type ` if any
  content = content.replace(/import \{ type type /g, 'import { type ');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log(`Updated ${file}`);
}
