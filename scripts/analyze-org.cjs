const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

const report = {};

for (const file of files) {
  const fullPath = path.join(dir, file);
  const code = fs.readFileSync(fullPath, 'utf8');
  const sourceFile = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);

  let exportCount = 0;
  let functionCount = 0;
  let imports = new Set();
  let methods = [];
  let currentClass = null;

  const getCyclomaticComplexity = (node) => {
    let complexity = 1;
    const visit = (n) => {
      if (
        ts.isIfStatement(n) ||
        ts.isForStatement(n) ||
        ts.isForInStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isWhileStatement(n) ||
        ts.isDoStatement(n) ||
        ts.isCaseClause(n) ||
        ts.isConditionalExpression(n) ||
        ts.isCatchClause(n) ||
        n.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.kind === ts.SyntaxKind.BarBarToken ||
        n.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity++;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return complexity;
  };

  const getLoc = (node) => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;
    return end - start + 1;
  };

  const traverse = (node) => {
    if (ts.isImportDeclaration(node)) {
      imports.add(node.moduleSpecifier.text);
    }
    
    if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (!ts.isExportDeclaration(node)) {
         exportCount++;
      }
    }
    if (ts.isExportDeclaration(node)) {
       exportCount += node.exportClause && node.exportClause.elements ? node.exportClause.elements.length : 1;
    }

    if (ts.isClassDeclaration(node)) {
      currentClass = node.name ? node.name.text : 'anonymous';
      ts.forEachChild(node, traverse);
      currentClass = null;
      return;
    }

    if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
      functionCount++;
      const name = node.name ? node.name.text : 'anonymous';
      const complexity = getCyclomaticComplexity(node);
      const loc = getLoc(node);
      methods.push({ name: currentClass ? `${currentClass}.${name}` : name, complexity, loc });
    }

    ts.forEachChild(node, traverse);
  };

  traverse(sourceFile);

  const totalLoc = code.split('\n').length;
  
  methods.sort((a, b) => b.loc - a.loc);
  const largestFunction = methods.length > 0 ? methods[0] : null;
  const avgComplexity = methods.length > 0 ? methods.reduce((acc, m) => acc + m.complexity, 0) / methods.length : 0;

  report[file] = {
    loc: totalLoc,
    exportCount,
    functionCount,
    imports: Array.from(imports),
    largestFunction,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    methods
  };
}

console.log(JSON.stringify(report, null, 2));
