import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip,
} from 'docx';

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Simple markdown inline parser for bold **text**, italic *text*, code `text`
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|[^*`]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const chunk = match[0];
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      runs.push(
        new TextRun({
          text: chunk.slice(2, -2),
          bold: true,
        })
      );
    } else if (chunk.startsWith('*') && chunk.endsWith('*')) {
      runs.push(
        new TextRun({
          text: chunk.slice(1, -1),
          italics: true,
        })
      );
    } else if (chunk.startsWith('`') && chunk.endsWith('`')) {
      runs.push(
        new TextRun({
          text: chunk.slice(1, -1),
          font: 'Consolas',
          size: 19,
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: chunk,
        })
      );
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

async function convertMarkdownToDocx(mdPath: string): Promise<Document> {
  const content = fs.readFileSync(mdPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const children: (Paragraph | Table)[] = [];

  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableRowsData: string[][] = [];

  const flushTable = () => {
    if (tableRowsData.length === 0) return;
    const numCols = Math.max(...tableRowsData.map((r) => r.length));
    const colWidth = Math.floor(9000 / (numCols || 1));

    const rows = tableRowsData.map((rowCells, rowIndex) => {
      const isHeader = rowIndex === 0;
      return new TableRow({
        tableHeader: isHeader,
        children: rowCells.map(
          (cellText) =>
            new TableCell({
              width: { size: colWidth, type: WidthType.DXA },
              shading: isHeader
                ? { fill: '003366' }
                : rowIndex % 2 === 1
                ? { fill: 'F9FAFB' }
                : undefined,
              children: [
                new Paragraph({
                  children: parseInlineFormatting(cellText.trim()).map((run) => {
                    if (isHeader) {
                      return new TextRun({
                        text: run.text,
                        bold: true,
                        color: 'FFFFFF',
                      });
                    }
                    return run;
                  }),
                }),
              ],
            })
        ),
      });
    });

    children.push(
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        rows,
      })
    );
    children.push(new Paragraph({ spacing: { after: 120 } }));
    tableRowsData = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block handling
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        inCodeBlock = false;
        for (const cLine of codeBlockLines) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: cLine,
                  font: 'Consolas',
                  size: 18,
                  color: '2E3440',
                }),
              ],
              spacing: { after: 40 },
            })
          );
        }
        children.push(new Paragraph({ spacing: { after: 120 } }));
        codeBlockLines = [];
      } else {
        if (inTable) flushTable();
        inCodeBlock = true;
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table handling
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const isSeparator = /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
      if (isSeparator) {
        // skip separator line
        continue;
      }
      const rawCells = line.trim().slice(1, -1).split('|');
      tableRowsData.push(rawCells);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Blank line
    if (!line.trim()) {
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          text: line.replace('# ', '').trim(),
          heading: HeadingLevel.TITLE,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          text: line.replace('## ', '').trim(),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          text: line.replace('### ', '').trim(),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 180, after: 80 },
        })
      );
    } else if (line.startsWith('#### ')) {
      children.push(
        new Paragraph({
          text: line.replace('#### ', '').trim(),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 140, after: 60 },
        })
      );
    } else if (line.startsWith('> ')) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(line.replace('> ', '').trim()),
          spacing: { before: 60, after: 60 },
        })
      );
    } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const bulletText = line.trim().replace(/^[-*]\s+/, '');
      children.push(
        new Paragraph({
          children: parseInlineFormatting(bulletText),
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    } else if (/^\d+\.\s+/.test(line.trim())) {
      const numText = line.trim().replace(/^\d+\.\s+/, '');
      children.push(
        new Paragraph({
          children: parseInlineFormatting(numText),
          spacing: { after: 60 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(line.trim()),
          spacing: { after: 100 },
        })
      );
    }
  }

  if (inTable) {
    flushTable();
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });
}

async function main() {
  const mdPath = path.resolve(process.cwd(), 'PRODUCT_OVERVIEW.md');
  console.log('Converting', mdPath, 'to docx...');
  const doc = await convertMarkdownToDocx(mdPath);
  const buffer = await Packer.toBuffer(doc);

  const targets = [
    path.resolve(process.cwd(), 'PRODUCT_OVERVIEW.docx'),
    path.resolve(process.cwd(), 'docs/PRODUCT_OVERVIEW.docx'),
    path.resolve(process.cwd(), 'overview.docx'),
    path.resolve(process.cwd(), 'docs/overview.docx'),
  ];

  for (const t of targets) {
    fs.writeFileSync(t, buffer);
    console.log('Wrote', t, buffer.length, 'bytes');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
