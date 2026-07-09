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

// 1. Fix controllers
const controllers = walk('src/modules/billing');
for (const file of controllers) {
  let content = fs.readFileSync(file, 'utf8');
  
  // A. Fix missing import RequestWithUser
  if (content.includes('as RequestWithUser') && !content.includes('RequestWithUser } from')) {
    content = content.replace(
      /import type \{ FastifyRequest, FastifyReply \} from 'fastify';/,
      "import type { FastifyRequest, FastifyReply } from 'fastify';\nimport type { RequestWithUser } from '../shared/types.js';"
    );
  }

  // B. Fix req.user is possibly undefined by adding `!` (non-null assertion)
  // i.e., change `req.user.orgId` to `req.user!.orgId` and `req.user.id` to `req.user!.id`
  content = content.replace(/req\.user\.orgId/g, 'req.user!.orgId');
  content = content.replace(/req\.user\.id/g, 'req.user!.id');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log(`Fixed controller: ${file}`);
}

// 2. Fix cron.ts
const cronFile = 'src/shared/workers/cron.ts';
if (fs.existsSync(cronFile)) {
  let cronContent = fs.readFileSync(cronFile, 'utf8');
  cronContent = cronContent.replace(/const billing = await registerBillingWorkers\(cronLogger\);\n/g, '');
  cronContent = cronContent.replace(/registerBillingWorkers\(runner\);\n/g, '');
  cronContent = cronContent.replace(/  const billing = await registerBillingWorkers\(cronLogger\);\n/g, '');
  
  // also find any dangling 'billing' reference that's unused
  fs.writeFileSync(cronFile, cronContent, 'utf8');
  console.log('Fixed cron.ts');
}
