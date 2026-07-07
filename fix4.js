import fs from 'fs';

let p = 'src/modules/projects/service.ts';
let c = fs.readFileSync(p, 'utf8');

let lines = c.split('\n');
let newLines = [];
for (let l of lines) {
  if (l.includes('ProjectMemberRole,') || l.includes('type ProjectOverviewDto,') || l.includes('type ProjectSettings,')) {
    continue;
  }
  newLines.push(l);
}
c = 'import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";\n' + newLines.join('\n');

// fix settings methods
c = c.replace(/const settings = await this\.settingsRepository\.findByProjectId\(orgId, projectId\);/g, 'const settings = await this.settingsRepository.findByProjectId(projectId);\n    if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);');

fs.writeFileSync(p, c);

let ap = 'src/modules/projects/api-key.repository.ts';
let ac = fs.readFileSync(ap, 'utf8');
ac = ac.replace(/data\.scopes/g, 'data.permissions');
fs.writeFileSync(ap, ac);

console.log('Fixed stuff');
