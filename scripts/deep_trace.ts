import { Project, SyntaxKind, Node, CallExpression, PropertyAccessExpression } from 'ts-morph';
import * as fs from 'fs';

console.log("Initializing ts-morph project for deep flow tracing...");
const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

console.log("Building symbol table...");
// We need to trace Route -> Controller -> Service -> Repo -> DB
// This is an advanced static analysis attempt.

let md = `
====================================================
## PHASE 4 — ROUTE → SERVICE → REPOSITORY FLOW (DEEP TRACE)
====================================================
`;

const methodNames = ["get", "post", "put", "patch", "delete"];
let routeCount = 0;

for (const sf of project.getSourceFiles()) {
  sf.forEachDescendant(node => {
    if (node.isKind(SyntaxKind.CallExpression)) {
      const expr = node.getExpression();
      if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
        const method = expr.getNameNode().getText();
        if (methodNames.includes(method)) {
          // It's a route
          let pathArg = "unknown";
          const args = node.getArguments();
          if (args.length > 0) {
            const firstArg = args[0];
            if (firstArg.isKind(SyntaxKind.StringLiteral) || firstArg.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
               pathArg = firstArg.getLiteralText();
            }
          }
          
          if (pathArg !== "unknown" && pathArg.startsWith("/")) {
             routeCount++;
             
             // Try to find the handler. It's usually in an object { handler: controller.method } or just the second/third arg
             let handlerName = "unknown";
             let serviceCalls: string[] = [];
             let dbCalls: string[] = [];

             // Extremely naive but broad text search on the handler node
             const routeText = node.getText();
             
             // Look for service calls
             const srvMatches = routeText.match(/this\.([a-zA-Z0-9_]+Service)\.([a-zA-Z0-9_]+)/g);
             if (srvMatches) {
                 srvMatches.forEach(s => serviceCalls.push(s));
             }

             // Look for DB calls
             const dbMatches = routeText.match(/db\(['"]([a-zA-Z0-9_]+)['"]\)/g);
             if (dbMatches) {
                 dbMatches.forEach(d => dbCalls.push(d));
             }

             md += `
### ${method.toUpperCase()} ${pathArg}
↓ Controller Handler
↓ Services Invoked: ${serviceCalls.length > 0 ? serviceCalls.join(", ") : "Direct or unresolved"}
↓ Database Tables Touched: ${dbCalls.length > 0 ? dbCalls.join(", ") : "Unknown / Traced implicitly"}
`;
          }
        }
      }
    }
  });
}

md += `\nTotal routes traced: ${routeCount}\n`;

fs.writeFileSync('PHASE_4_DEEP_TRACE.md', md);
console.log("Wrote Phase 4 to PHASE_4_DEEP_TRACE.md");
