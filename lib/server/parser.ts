// lib/server/parser.ts
import { Effect } from "effect";
import type { BlockId, NewBlock } from "../../types/generated/public/Block";
import { generateId } from "./utils";
import type { Crypto } from "./crypto";
import type { UserId } from "../../types/generated/public/User";

const tagRegex = /#([\w-]+)/g;
const linkRegex = /\[\[([^\]]+)\]\]/g;
const transclusionRegex = /!\[\[([^\]]+)\]\]/g;
const fieldRegex = /^\s*([^:]+?)::\s*(.*)$/;

function parseLineComponents(line: string) {
  const tags = [...line.matchAll(tagRegex)].map((m) => m[0]);
  const links = [...line.matchAll(linkRegex)].map((m) => m[1]);
  const transclusions = [...line.matchAll(transclusionRegex)].map((m) => m[1]);

  const content = line
    .replace(tagRegex, "")
    .replace(linkRegex, "")
    .replace(transclusionRegex, "")
    .trim();
  return { content, tags, links, transclusions };
}

export const parseMarkdownToBlocks = (
  markdownContent: string,
  filePath: string,
  userId: UserId,
): Effect.Effect<NewBlock[], never, Crypto> =>
  Effect.gen(function* () {
    const lines = markdownContent.split("\n");
    const blocks: NewBlock[] = [];
    const parentStack: (NewBlock & { depth: number })[] = [];

    let order = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      const indentMatch = line.match(/^\s*/);

      const indentation = indentMatch ? indentMatch[0].length : 0;
      const depth = Math.floor(indentation / 2);

      const fieldMatch = line.match(fieldRegex);

      while (
        parentStack.length > 0 &&
        parentStack[parentStack.length - 1].depth >= depth
      ) {
        parentStack.pop();
      }

      const parent =
        parentStack.length > 0
          ? parentStack[parentStack.length - 1]
          : undefined;

      if (fieldMatch && parent) {
        const key = fieldMatch[1].trim();
        const value = fieldMatch[2].trim();
        // FIX: Use `unknown` instead of `any` for better type safety.
        parent.fields = {
          ...(parent.fields as Record<string, unknown>),
          [key]: value,
        };
        continue;
      }

      const { content, tags, links, transclusions } = parseLineComponents(line);
      if (!content) continue;
      const id = (yield* generateId(36)) as BlockId;
      const now = new Date();
      const newBlock: NewBlock & { depth: number } = {
        id,
        user_id: userId,
        type: tags[0]?.substring(1) || "note",
        content,
        fields: {},
        tags,
        links,
        transclusions,
        file_path: filePath,
        parent_id: parent?.id ?? null,
        depth,
        order: order++,
        created_at: now,
        updated_at: now,
        version: 0,
      };
      blocks.push(newBlock);
      parentStack.push(newBlock);
    }

    return blocks;
  });
