import type { ReactNode } from "react";

/**
 * Рендерит ролевой текст:
 *  - *текст в звёздочках* -> полупрозрачный курсив (действия/окружение)
 *  - строки, начинающиеся с — -> яркая прямая речь
 */
export function renderRoleplayText(raw: string): ReactNode[] {
  const lines = raw.split(/\n/);
  const nodes: ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    const segments = splitByAsterisks(line);
    const isDialogueLine = /^\s*[—-]/.test(line);

    nodes.push(
      <span key={`l-${lineIdx}`} className={isDialogueLine ? "rp-dialogue" : undefined}>
        {segments.map((seg, i) =>
          seg.isAction ? (
            <em key={i} className="rp-action">
              {seg.text}
            </em>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </span>
    );
    if (lineIdx < lines.length - 1) nodes.push(<br key={`br-${lineIdx}`} />);
  });

  return nodes;
}

function splitByAsterisks(line: string): { text: string; isAction: boolean }[] {
  const parts: { text: string; isAction: boolean }[] = [];
  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: line.slice(lastIndex, match.index), isAction: false });
    }
    parts.push({ text: match[1], isAction: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex), isAction: false });
  }
  if (parts.length === 0) parts.push({ text: line, isAction: false });
  return parts;
}
