import { parseInline, type NoticeBlock } from "./legalNotice";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, i) =>
        piece.kind === "bold" ? <strong key={i}>{piece.text}</strong> : piece.kind === "code" ? <code key={i}>{piece.text}</code> : piece.text,
      )}
    </>
  );
}

// Renders the parsed notice blocks as real headings, paragraphs and lists (no innerHTML).
export function LegalNoticeText({ blocks }: { blocks: NoticeBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return block.level === 2 ? (
            <h3 key={i}>
              <Inline text={block.text} />
            </h3>
          ) : (
            <h4 key={i}>
              <Inline text={block.text} />
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        );
      })}
    </>
  );
}
