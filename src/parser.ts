import * as fs from 'fs';
import * as path from 'path';

export interface MarkdownChunk {
  id: string;
  title: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

export interface AgentSegment {
  prompt: string;
  fullContent: string;
  startIndex: number;
  endIndex: number;
}

export function chunkMarkdown(content: string): MarkdownChunk[] {
  const lines = content.split('\n');
  const chunks: MarkdownChunk[] = [];
  let currentChunk: MarkdownChunk | null = null;
  let chunkId = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const headerMatch = line.match(/^#\s+(.+)$/); // Only match level 1 headers

    if (headerMatch) {
      // Save previous chunk
      if (currentChunk) {
        currentChunk.endLine = index - 1;
        chunks.push(currentChunk);
      }

      // Start new chunk
      currentChunk = {
        id: `chunk-${chunkId++}`,
        title: headerMatch[1],
        level: 1,
        content: line + '\n',
        startLine: index,
        endLine: index
      };
    } else {
      // Either append to current chunk or start preamble
      if (currentChunk) {
        currentChunk.content += line + '\n';
      } else {
        // Preamble (content before first # header)
        currentChunk = {
          id: `chunk-preamble`,
          title: 'Preamble',
          level: 0,
          content: line + '\n',
          startLine: 0,
          endLine: index
        };
      }
    }
  }

  // Save last chunk
  if (currentChunk) {
    currentChunk.endLine = lines.length - 1;
    chunks.push(currentChunk);
  }

  return chunks;
}

export function findAgentSegments(content: string): AgentSegment[] {
  const segments: AgentSegment[] = [];
  const agentRegex = /<agent>([\s\S]*?)<\/agent>/g;

  let match;
  while ((match = agentRegex.exec(content)) !== null) {
    const fullContent = match[1];
    const promptMatch = fullContent.match(/<prompt>([\s\S]*?)<\/prompt>/);

    if (promptMatch) {
      segments.push({
        prompt: promptMatch[1].trim(),
        fullContent: fullContent,
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }
  }

  return segments;
}

export function loadMemoryFiles(memoryDir: string): Map<string, string> {
  const memory = new Map<string, string>();

  if (!fs.existsSync(memoryDir)) {
    return memory;
  }

  const files = fs.readdirSync(memoryDir);

  for (const file of files) {
    if (file.endsWith('.md')) {
      const filePath = path.join(memoryDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      memory.set(file, content);
    }
  }

  return memory;
}
