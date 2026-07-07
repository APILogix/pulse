import fs from 'fs';

// Fix api-key.repository.ts
let ap = 'src/modules/projects/api-key.repository.ts';
let ac = fs.readFileSync(ap, 'utf8');

// Cast return in api-key.repository.ts
if (!ac.includes('as unknown as ProjectApiKey')) {
  ac = ac.replace(
    /return \{\n\s*id: row\.id,/g,
    `return {\n      id: row.id,`
  );
  ac = ac.replace(
    /updatedAt: row\.updated_at,\n\s*\};/g,
    `updatedAt: row.updated_at,\n    } as unknown as ProjectApiKey;`
  );
}

// Fix service.ts
let p = 'src/modules/projects/service.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /import type \{\n  ApiKeyUsage,([\s\S]*?)ProjectMemberRole,\n  type ProjectOverviewDto,\n  type ProjectSettings,\n\} from "\.\/types\.js";/g,
  `import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";\nimport type {\n  ApiKeyUsage,$1} from "./types.js";`
);

// Fix updateProjectSettings signature
c = c.replace(
  /const result = await this\.settingsRepository\.update\(orgId, projectId, updates\);/g,
  `const result = await this.settingsRepository.update(projectId, updates);`
);

fs.writeFileSync(ap, ac);
fs.writeFileSync(p, c);
console.log('Done fix3');
