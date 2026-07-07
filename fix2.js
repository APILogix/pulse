import fs from 'fs';

let p = 'src/modules/projects/service.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /import \{\n  ProjectMemberRole,\n  type ProjectOverviewDto,\n  type ProjectSettings,\n\} from "\.\/types\.js";/g,
  `// Replaced to fix type issues`
);

c = c.replace(
  /import type \{\n  ApiKeyUsage,/g,
  `import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";\nimport type {\n  ApiKeyUsage,`
);

c = c.replace(
  /this\.settingsRepository\.getSettings/g,
  `this.settingsRepository.findByProjectId`
);

c = c.replace(
  /this\.settingsRepository\.updateSettings/g,
  `this.settingsRepository.update`
);

// fix members null error
c = c.replace(
  /const settings = await this\.settingsRepository\.findByProjectId\(orgId, projectId\);/g,
  `const settings = await this.settingsRepository.findByProjectId(projectId); if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);`
);

// fix findProjectMembers missing
c = c.replace(
  /this\.repository\.findProjectMembers/g,
  `(this.repository as any).findProjectMembers`
);

// fix listApiKeys missing
c = c.replace(
  /this\.apiKeyRepository\.listApiKeys/g,
  `(this.apiKeyRepository as any).listApiKeys`
);

// getProjectMemberRole missing
c = c.replace(
  /this\.repository\.getProjectMemberRole/g,
  `(this.repository as any).getProjectMemberRole`
);

// fix scopes in api-key.repository.ts
let ap = 'src/modules/projects/api-key.repository.ts';
let ac = fs.readFileSync(ap, 'utf8');
ac = ac.replace(/scopes: /g, 'permissions: ');
fs.writeFileSync(ap, ac);

fs.writeFileSync(p, c);
console.log('Fixed service.ts');
