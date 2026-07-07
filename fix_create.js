import fs from 'fs';
const p = 'c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository.ts';
let content = fs.readFileSync(p, 'utf8');

const createProjectStart = content.indexOf('  async createProject(');
const createProjectEnd = content.indexOf('  async findProjectBySlug(', createProjectStart);
const oldCreateProject = content.substring(createProjectStart, createProjectEnd);

const newCreateProject = `  async createProject(
    input: {
      orgId: string;
      name: string;
      slug: string;
      description: string | null;
      environment: ProjectEnvironment;
      productionApiPrefix: string | null;
      developmentApiPrefix: string | null;
      stagingApiPrefix: string | null;
      config: ProjectUpdateInput;
    },
    client?: PoolClient,
  ): Promise<Project> {
    const db = client ?? this.db;
    try {
      const result = await db.query<ProjectRow>(
        \`INSERT INTO projects (
           org_id, name, slug, description, default_environment
         ) VALUES (
           $1,$2,$3,$4,$5
         )
         RETURNING \${PROJECT_COLUMNS}\`,
        [
          input.orgId,
          input.name,
          input.slug,
          input.description,
          input.environment,
        ],
      );

      return this.mapProject(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ProjectError(
          "PROJECT_SLUG_EXISTS",
          "A project with the same slug already exists in this organization",
          409,
        );
      }
      throw error;
    }
  }

`;

content = content.replace(oldCreateProject, newCreateProject);

fs.writeFileSync(p, content);
console.log('Fixed createProject in repository.ts');
