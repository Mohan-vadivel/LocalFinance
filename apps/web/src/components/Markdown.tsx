import { Fragment, type ReactNode } from 'react';

/**
 * A tiny, safe Markdown renderer for AI answers: paragraphs, headings (shown bold), **bold**, bullet and numbered
 * lists, and pipe tables. It builds React elements only (never HTML strings), so nothing in the text can run.
 */

/** **bold** spans inside one line. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${key}-b${i++}`}>{m[1] ?? m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
/** Numbers and money read better right-aligned in a table. */
const numeric = (s: string) => /^[-+]?[₹Rs.\s]*[\d,]+(\.\d+)?\s*%?$/.test(s);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const key = `b${k++}`;
    // Pipe table: a header row, a --- separator row, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) body.push(cells(lines[i++]));
      const numCol = head.map((_, j) => body.length > 0 && body.every((r) => !r[j] || numeric(r[j])));
      blocks.push(
        <div className="md-table" key={key}>
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} className={numCol[j] ? 'num' : undefined}>{inline(c, `${key}h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, j) => (
                    <td key={j} className={numCol[j] ? 'num' : undefined}>
                      {inline(r[j] ?? '', `${key}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const re = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].match(re)![1]);
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}i${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      blocks.push(
        <p key={key} className="md-h">
          <strong>{inline(h[1].replace(/\*\*/g, ''), key)}</strong>
        </p>,
      );
      i++;
      continue;
    }
    // Paragraph: consecutive plain lines, kept as line breaks.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBER.test(lines[i]) && !HEADING.test(lines[i]) && !(isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1]))) para.push(lines[i++]);
    blocks.push(
      <p key={key}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p.trim(), `${key}p${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
