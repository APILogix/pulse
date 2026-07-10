const fs = require('fs');
const { Project } = require('ts-morph');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/projects/**/*.ts');

// 1. Add buildProjectAssignments back to ProjectRepository
const coreRepo = project.getSourceFile('src/modules/projects/core/project.repository.ts');
if (coreRepo && !coreRepo.getClass('ProjectRepository').getMethod('buildProjectAssignments')) {
    coreRepo.getClass('ProjectRepository').addMethod({
        name: 'buildProjectAssignments',
        scope: 'private',
        parameters: [
            { name: 'orgRole', type: 'string' },
            { name: 'overrides', type: 'Record<string, string>' }
        ],
        returnType: '{ assignments: string[]; values: unknown[] }',
        statements: `
    const assignments: string[] = [];
    const values: unknown[] = [];
    let idx = 3; // Start after orgId, limit, offset

    // Apply org-level role defaults first
    if (orgRole === "admin") {
      assignments.push("'admin'");
    } else {
      assignments.push("'member'");
    }

    // Apply any project-specific overrides
    for (const [projectId, role] of Object.entries(overrides)) {
      assignments.push("WHEN id = $" + idx + " THEN $" + (idx + 1));
      values.push(projectId, role);
      idx += 2;
    }

    return { assignments, values };
        `
    });
}

// Clean up duplicate exports
['core/project', 'members/member', 'usage/project-usage', 'settings/project-settings'].forEach(d => {
    const file = project.getSourceFile('src/modules/projects/' + d + '.repository.ts');
    if (file) {
        file.getInterfaces().forEach(i => i.setIsExported(false));
    }
});

project.saveSync();
console.log('Fixed typings for project repositories');
