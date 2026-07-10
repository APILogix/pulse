const { Project, SyntaxKind } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const project = new Project();
project.addSourceFilesAtPaths('src/modules/alerting/**/*.ts');
project.addSourceFilesAtPaths('src/modules/connectors/**/*.ts');

const reports = [];
const dependencies = {};

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  const relPath = path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
  
  // Calculate LOC
  const loc = sourceFile.getEndLineNumber();
  
  // Get imports
  const imports = sourceFile.getImportDeclarations().map(imp => imp.getModuleSpecifierValue());
  dependencies[relPath] = imports;
  
  // Get exports
  const exports = Array.from(sourceFile.getExportedDeclarations().keys());
  
  // Get functions
  const functions = sourceFile.getFunctions();
  const classes = sourceFile.getClasses();
  
  let largestFunction = 0;
  let methodCount = 0;
  
  functions.forEach(f => {
    const size = f.getEndLineNumber() - f.getStartLineNumber();
    if (size > largestFunction) largestFunction = size;
  });
  
  classes.forEach(c => {
    c.getMethods().forEach(m => {
      methodCount++;
      const size = m.getEndLineNumber() - m.getStartLineNumber();
      if (size > largestFunction) largestFunction = size;
    });
  });
  
  // Complexity heuristic
  let cyclomaticEstimate = 1;
  const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);
  const forStatements = sourceFile.getDescendantsOfKind(SyntaxKind.ForStatement);
  const switchStatements = sourceFile.getDescendantsOfKind(SyntaxKind.SwitchStatement);
  const catchClauses = sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause);
  
  cyclomaticEstimate += ifStatements.length + forStatements.length + switchStatements.length + catchClauses.length;
  
  reports.push({
    file: relPath,
    loc,
    importCount: imports.length,
    exportCount: exports.length,
    functionCount: functions.length + methodCount,
    classCount: classes.length,
    largestFunctionLOC: largestFunction,
    complexityEstimate: cyclomaticEstimate,
    exports: exports
  });
}

fs.writeFileSync('analysis.json', JSON.stringify({ reports, dependencies }, null, 2));
console.log('Analysis complete. Wrote to analysis.json');
