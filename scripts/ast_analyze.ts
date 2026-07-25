import { Project, ClassDeclaration, FunctionDeclaration, Identifier, CallExpression, SyntaxKind, Decorator } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

console.log("Initializing ts-morph project...");
const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

const output: any = {
  modules: [],
  routes: [],
  services: [],
  repositories: [],
  tables: new Set<string>(),
  flows: []
};

// 1. MODULES
const modulesDir = project.getDirectory("src/modules");
if (modulesDir) {
  const dirs = modulesDir.getDirectories();
  for (const d of dirs) {
    const modName = d.getBaseName();
    
    // Find controllers, services, repos
    const sourceFiles = d.getDescendantSourceFiles();
    
    let ctrlCount = 0;
    let srvCount = 0;
    let repoCount = 0;
    let dtoCount = 0;
    
    for (const sf of sourceFiles) {
      const fileName = sf.getBaseName();
      if (fileName.includes(".controller.") || fileName.includes(".routes.")) ctrlCount++;
      if (fileName.includes(".service.")) srvCount++;
      if (fileName.includes(".repository.") || fileName.includes(".repo.")) repoCount++;
      if (fileName.includes(".schema.") || fileName.includes(".dto.")) dtoCount++;
    }

    output.modules.push({
      name: modName,
      purpose: `Manage ${modName} domain`,
      controllers: ctrlCount,
      services: srvCount,
      repositories: repoCount,
      dtos: dtoCount
    });
  }
}

// 2. ROUTES
// Search for fastify route declarations: app.get, app.post, etc.
const methodNames = ["get", "post", "put", "patch", "delete", "route"];
for (const sf of project.getSourceFiles()) {
  sf.forEachDescendant(node => {
    if (node.isKind(SyntaxKind.CallExpression)) {
      const expr = node.getExpression();
      if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
        const method = expr.getNameNode().getText();
        if (methodNames.includes(method)) {
          // It's likely a route
          let pathArg = "unknown";
          const args = node.getArguments();
          if (args.length > 0) {
            const firstArg = args[0];
            if (firstArg.isKind(SyntaxKind.StringLiteral) || firstArg.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
               pathArg = firstArg.getLiteralText();
            }
          }
          
          if (pathArg !== "unknown" && pathArg.startsWith("/")) {
             let isAuth = false;
             let isOrgScoped = false;
             let isProjScoped = false;
             let permissions: string[] = [];

             // check config for decorators, preHandler, etc.
             const text = node.getText();
             if (text.includes("requireAuth") || text.includes("jwt") || text.includes("auth")) isAuth = true;
             if (text.includes("organizationId") || pathArg.includes(":orgId") || pathArg.includes(":organizationId") || text.includes("requireOrg")) isOrgScoped = true;
             if (text.includes("projectId") || pathArg.includes(":projectId") || text.includes("requireProject")) isProjScoped = true;
             
             // Extract permission if possible
             const permMatch = text.match(/permissions?:\s*\[?['"]([^'"]+)['"]/);
             if (permMatch) permissions.push(permMatch[1]);

             output.routes.push({
               method: method.toUpperCase(),
               path: pathArg,
               file: sf.getFilePath(),
               isAuth,
               isOrgScoped,
               isProjScoped,
               permissions
             });
          }
        }
      }
    }
  });
}

// 3. SERVICES & REPOSITORIES
for (const sf of project.getSourceFiles()) {
  const classes = sf.getClasses();
  for (const cls of classes) {
    const name = cls.getName();
    if (!name) continue;
    
    const methods = cls.getMethods().map(m => m.getName());
    
    // Dependencies via constructor
    const deps = cls.getConstructors().flatMap(c => c.getParameters().map(p => p.getType().getText()));

    if (name.includes("Service")) {
      output.services.push({ name, file: sf.getFilePath(), methods, deps });
    } else if (name.includes("Repository") || name.includes("Repo")) {
      // Find table usages
      const tableMatches = sf.getText().match(/from\s+([a-z_]+)|into\s+([a-z_]+)|update\s+([a-z_]+)|db\(['"]([a-z_]+)['"]\)/gi);
      let tables = new Set<string>();
      if (tableMatches) {
         for (const match of tableMatches) {
            const parts = match.split(/\s+|['"()]/).filter(Boolean);
            const tbl = parts[parts.length - 1].toLowerCase();
            if (tbl !== "from" && tbl !== "into" && tbl !== "update" && tbl !== "db") tables.add(tbl);
         }
      }

      output.repositories.push({ name, file: sf.getFilePath(), methods, tables: Array.from(tables) });
      tables.forEach(t => output.tables.add(t));
    }
  }
}

output.tables = Array.from(output.tables);

fs.writeFileSync("analysis_results.json", JSON.stringify(output, null, 2));
console.log("Analysis written to analysis_results.json");
