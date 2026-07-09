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
  
  // 1. Fix the method signature: request: RequestWithUser -> request: FastifyRequest
  content = content.replace(/request: RequestWithUser/g, 'request: FastifyRequest');
  
  // 2. Fix the imports: add type for FastifyRequest if missing
  if (!content.includes('import type { FastifyRequest')) {
    content = content.replace(/import type \{ FastifyReply \} from 'fastify';/, "import type { FastifyRequest, FastifyReply } from 'fastify';");
  }
  
  // 3. Change import { RequestWithUser } to import type { RequestWithUser }
  content = content.replace(/import \{ RequestWithUser \}/g, 'import type { RequestWithUser }');
  
  // 4. For every handler, insert `const req = request as RequestWithUser;`
  // We can find `try {\n` and replace it
  content = content.replace(/try \{/g, 'const req = request as RequestWithUser;\n    try {');
  
  // 5. Replace request.user with req.user, request.body with req.body, etc.
  content = content.replace(/request\.user/g, 'req.user');
  content = content.replace(/request\.body/g, 'req.body');
  content = content.replace(/request\.query/g, 'req.query');
  content = content.replace(/request\.params/g, 'req.params');

  // Fix the optional chaining that I accidentally added via powershell earlier
  content = content.replace(/req\.user\?\.orgId/g, 'req.user.orgId');
  content = content.replace(/req\.user\?\.id/g, 'req.user.id');

  // 6. Fix `TS1484` type-only imports for body/query/params schemas
  // E.g. import { ConsumeAiCreditsSchema, ConsumeAiCreditsBody } from './schemas.ts';
  // Needs to become import { ConsumeAiCreditsSchema, type ConsumeAiCreditsBody }
  // A heuristic: replace all occurrences of `Body }`, `Query }`, `Params }` with `type ...`
  // Actually, better:
  content = content.replace(/([A-Za-z0-9]+Body)(,?)/g, 'type $1$2');
  content = content.replace(/([A-Za-z0-9]+Query)(,?)/g, 'type $1$2');
  content = content.replace(/([A-Za-z0-9]+Params)(,?)/g, 'type $1$2');
  // cleanup double `type type` if any
  content = content.replace(/type type/g, 'type');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log(`Updated ${file}`);
}
