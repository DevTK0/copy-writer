import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AgentOptions {
  prompt: string;
  context?: string;
  memory?: Map<string, string>;
}

export async function generateWithClaude(options: AgentOptions): Promise<string> {
  const { prompt, context, memory } = options;

  let fullPrompt = '';

  if (memory && memory.size > 0) {
    fullPrompt += '# Memory Context\n\n';
    for (const [filename, content] of memory.entries()) {
      fullPrompt += `## ${filename}\n\n${content}\n\n`;
    }
    fullPrompt += '---\n\n';
  }

  if (context) {
    fullPrompt += '# Current Section Context\n\n';
    fullPrompt += context + '\n\n';
    fullPrompt += '---\n\n';
  }

  fullPrompt += '# Task\n\n';
  fullPrompt += prompt;
  fullPrompt += '\n\n---\n\n';
  fullPrompt += '# Important Instructions\n\n';
  fullPrompt += 'Return ONLY the generated content as plain text. Do NOT write to files, do NOT execute commands. You MAY use web search if needed to gather information. Just output the text content directly.';

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

    const claude = spawn('claude', ['--print'], {
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
