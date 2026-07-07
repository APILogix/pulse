import fs from 'fs';
const p = 'c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository.ts';
let content = fs.readFileSync(p, 'utf8');

const buildStart = content.indexOf('  private buildProjectAssignments(input: ProjectUpdateInput): {');
const buildEnd = content.indexOf('    return { assignments, values };', buildStart) + 36;
const oldBuild = content.substring(buildStart, buildEnd);

const newBuild = `  private buildProjectAssignments(input: ProjectUpdateInput): {
    assignments: string[];
    values: unknown[];
  } {
    const assignments: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const set = (col: string, val: unknown) => {
      assignments.push(\`\${col} = $\${i++}\`);
      values.push(val);
    };

    if (input.name !== undefined) set("name", input.name);
    if (input.description !== undefined) set("description", input.description);
    if (input.status !== undefined) set("status", input.status);
    if (input.environment !== undefined) set("default_environment", input.environment);
    if (input.archivedAt !== undefined) set("archived_at", input.archivedAt);

    return { assignments, values };
  }`;

content = content.replace(oldBuild, newBuild);

// Also prefixedProjectRow is mapping p_* columns that don't exist in JOINs!
const prefixedStart = content.indexOf('  private prefixedProjectRow(row: Record<string, unknown>): ProjectRow {');
const prefixedEnd = content.indexOf('  }', prefixedStart) + 3;
const oldPrefixed = content.substring(prefixedStart, prefixedEnd);

const newPrefixed = `  private prefixedProjectRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: row.p_id as string,
      org_id: row.p_org_id as string,
      name: row.p_name as string,
      slug: row.p_slug as string,
      description: row.p_description as string | null,
      status: row.p_status as ProjectStatus,
      environment: row.p_environment as ProjectEnvironment,
      archived_at: row.p_archived_at as Date | null,
      deleted_at: row.p_deleted_at as Date | null,
      created_at: row.p_created_at as Date,
      updated_at: row.p_updated_at as Date,
    } as any;
  }`;
content = content.replace(oldPrefixed, newPrefixed);

fs.writeFileSync(p, content);
console.log('Fixed buildProjectAssignments and prefixedProjectRow');
