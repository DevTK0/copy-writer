import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentOptions {
  prompt: string;
  existingContent?: string;
  context?: string;
  memory?: Map<string, string>;
  mode?: 'prompt' | 'autoprompt' | 'research';
}

export async function generateWithClaude(options: AgentOptions): Promise<string> {
  const { prompt, existingContent, context, memory, mode = 'prompt' } = options;

  let fullPrompt = '';

  if (memory && memory.size > 0) {
    fullPrompt += '# Memory Context\n\n';
    for (const [filename, content] of memory.entries()) {
      fullPrompt += `## ${filename}\n\n${content}\n\n`;
    }
    fullPrompt += '---\n\n';
  }

  if (context) {
    fullPrompt += '# Page Context\n\n';
    fullPrompt += context + '\n\n';
    fullPrompt += '---\n\n';
  }

  if (mode === 'research') {
    // Research mode: do comprehensive research and create a markdown document
    fullPrompt += '# Research Task\n\n';
    fullPrompt += prompt;
    fullPrompt += '\n\n---\n\n';
    fullPrompt += '# Important Instructions\n\n';
    fullPrompt += 'You are a research assistant. Your task is to research the topic above thoroughly.\n\n';
    fullPrompt += 'Use web search to gather comprehensive information. If specific URLs are provided, fetch and analyze their content.\n\n';
    fullPrompt += 'Create a well-structured markdown document with your findings. Include:\n';
    fullPrompt += '- Key facts and information\n';
    fullPrompt += '- Important details, statistics, or quotes\n';
    fullPrompt += '- Relevant context and background\n';
    fullPrompt += '- Sources where applicable\n\n';
    fullPrompt += 'Format the output as clean markdown. This document will be used as reference material for content creation.\n\n';
    fullPrompt += 'Return ONLY the markdown document. No meta-commentary or explanations outside the document.';
  } else if (mode === 'autoprompt') {
    // Autoprompt mode: research the topic and suggest a concise prompt
    fullPrompt += '# Research Task\n\n';
    fullPrompt += prompt;
    fullPrompt += '\n\n---\n\n';
    fullPrompt += '# Important Instructions\n\n';
    fullPrompt += 'You are a research assistant. Search the web to gather information about the topic above.\n\n';
    fullPrompt += 'After researching, write a SHORT, CONCISE prompt (1-2 sentences max) that could be used to generate content about this topic.\n\n';
    fullPrompt += 'The prompt should capture the key points from your research. It should be actionable and specific.\n\n';
    fullPrompt += 'Return ONLY the suggested prompt text. No explanations, no formatting, just the prompt itself.';
  } else if (existingContent) {
    fullPrompt += '# Content to Edit\n\n';
    fullPrompt += existingContent + '\n\n';
    fullPrompt += '---\n\n';
    fullPrompt += '# Edit Instructions\n\n';
    fullPrompt += prompt;
    fullPrompt += '\n\n---\n\n';
    fullPrompt += '# Important Instructions\n\n';
    fullPrompt += 'Edit the content above based on the instructions. Return ONLY the edited content as plain text. Keep the same format and style. Do NOT write to files, do NOT execute commands. Just output the edited text directly.';
  } else {
    fullPrompt += '# Task\n\n';
    fullPrompt += prompt;
    fullPrompt += '\n\n---\n\n';
    fullPrompt += '# Important Instructions\n\n';
    fullPrompt += 'Return ONLY the generated content as plain text. Do NOT write to files, do NOT execute commands. You MAY use web search if needed to gather information. Just output the text content directly.';
  }

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `claude-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, fullPrompt);

  try {
    const result = await runClaudeHeadless(tmpFile);
    return result;
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

function runClaudeHeadless(promptFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const prompt = fs.readFileSync(promptFile, 'utf-8');

    const claude = spawn('claude', ['--print', '--allowedTools', 'WebSearch,WebFetch'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    claude.stdin.write(prompt);
    claude.stdin.end();

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claude.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude Code exited with code ${code}\n${stderr}`));
      }
    });

    claude.on('error', (error) => {
      reject(new Error(`Failed to start Claude Code: ${error.message}`));
    });
  });
}
