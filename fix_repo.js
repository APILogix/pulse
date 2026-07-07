import fs from 'fs';
const p = 'c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  '  id, org_id, name, slug, description, status, environment,',
  '  id, org_id, name, slug, description, status, default_environment AS environment,'
);

content = content.replace(
  'whereClauses.push(`p.environment = $${params.length}`);',
  'whereClauses.push(`p.default_environment = $${params.length}`);'
);

fs.writeFileSync(p, content);
console.log('Fixed repository.ts');
