import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { Type } from '@sinclair/typebox';
import type { AnyAgentTool } from 'openclaw/plugin-sdk/core';

interface ToolConfig {
  url: string;
  projectDir?: string;
}

// ─── openmaic_manage ────────────────────────────────────────────────

function detectPackageManager(cwd: string): 'pnpm' | 'npm' {
  try {
    execSync('pnpm --version', { cwd, stdio: 'pipe' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}

const ManageToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('status'),
      Type.Literal('start'),
      Type.Literal('stop'),
      Type.Literal('install'),
    ],
    { description: 'Action to perform: status, start, stop, or install' },
  ),
});

export function createManageTool(config: ToolConfig): AnyAgentTool {
  return {
    name: 'openmaic_manage',
    label: 'OpenMAIC Manage',
    description:
      'Manage OpenMAIC server lifecycle. Actions: status (check if running), start (build & start server), stop (kill server process), install (install dependencies).',
    parameters: ManageToolSchema,
    async execute(_toolCallId, params) {
      const { action } = params as { action: string };
      const text = await executeManage(action, config);
      return { content: [{ type: 'text', text }], details: { action } };
    },
  } as AnyAgentTool;
}

async function executeManage(action: string, config: ToolConfig): Promise<string> {
  if (action !== 'status' && !config.projectDir) {
    return 'Error: projectDir is not configured. Set it in your OpenClaw plugin config.';
  }

  const cwd = config.projectDir!;

  switch (action) {
    case 'status': {
      try {
        const res = await fetch(`${config.url}/api/health`);
        if (res.ok) {
          const data = await res.json();
          return `OpenMAIC is running at ${config.url} (version: ${data.version || 'unknown'})`;
        }
        return `OpenMAIC is not responding at ${config.url}.`;
      } catch {
        return `OpenMAIC is not running at ${config.url}.`;
      }
    }

    case 'install': {
      const pm = detectPackageManager(cwd);
      try {
        execSync(`${pm} install`, { cwd, encoding: 'utf-8', timeout: 120_000 });
        return `Dependencies installed successfully with ${pm}.`;
      } catch (e) {
        return `Failed to install dependencies: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'start': {
      const pm = detectPackageManager(cwd);
      try {
        execSync(`${pm} run build`, { cwd, encoding: 'utf-8', timeout: 300_000 });
        execSync(`nohup ${pm} run start > "${cwd}/openmaic.log" 2>&1 &`, {
          cwd,
          encoding: 'utf-8',
          shell: '/bin/bash',
        });
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const res = await fetch(`${config.url}/api/health`);
            if (res.ok) {
              return `OpenMAIC started successfully at ${config.url}`;
            }
          } catch {
            // Still starting up
          }
        }
        return `OpenMAIC build completed and server starting. Check ${config.url} shortly.`;
      } catch (e) {
        return `Failed to start OpenMAIC: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case 'stop': {
      try {
        const port = new URL(config.url).port || '3000';
        const result = execSync(`lsof -ti :${port}`, { cwd, encoding: 'utf-8' }).trim();
        if (result) {
          execSync(`kill ${result}`, { cwd, encoding: 'utf-8' });
          return 'OpenMAIC stopped.';
        }
        return 'OpenMAIC is not running (no process found on the configured port).';
      } catch {
        return 'OpenMAIC is not running (no process found on the configured port).';
      }
    }

    default:
      return `Unknown action: ${action}. Valid actions: status, start, stop, install`;
  }
}

// ─── openmaic_generate ──────────────────────────────────────────────

const GenerateToolSchema = Type.Object({
  requirement: Type.String({
    description:
      'Free-form requirement for the classroom. Can be a topic, detailed instructions, student background, or any combination.',
  }),
  pdfPath: Type.Optional(
    Type.String({ description: 'Path to a PDF file to use as source material' }),
  ),
});

export function createGenerateTool(config: Pick<ToolConfig, 'url'>): AnyAgentTool {
  return {
    name: 'openmaic_generate',
    label: 'OpenMAIC Generate',
    description:
      'Generate an interactive classroom from a requirement description and/or PDF. Returns a URL to the generated classroom.',
    parameters: GenerateToolSchema,
    async execute(_toolCallId, params) {
      const { requirement, pdfPath } = params as {
        requirement: string;
        pdfPath?: string;
      };
      const text = await executeGenerate({ requirement, pdfPath }, config.url);
      return { content: [{ type: 'text', text }], details: { requirement, pdfPath } };
    },
  } as AnyAgentTool;
}

async function executeGenerate(
  input: { requirement: string; pdfPath?: string },
  baseUrl: string,
): Promise<string> {
  // 1. Health check
  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    if (!healthRes.ok) {
      return `OpenMAIC is not reachable at ${baseUrl}. Start it first with openmaic_manage { action: "start" }.`;
    }
  } catch {
    return `OpenMAIC is not reachable at ${baseUrl}. Start it first with openmaic_manage { action: "start" }.`;
  }

  // 2. Build request body
  let pdfContent: { text: string; images: string[] } | undefined;

  if (input.pdfPath) {
    try {
      const pdfBuffer = await readFile(input.pdfPath);
      const formData = new FormData();
      formData.append('pdf', new Blob([pdfBuffer], { type: 'application/pdf' }), 'document.pdf');

      const parseRes = await fetch(`${baseUrl}/api/parse-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        return `Failed to parse PDF: ${(err as { error?: string }).error || parseRes.statusText}`;
      }

      const parseData = await parseRes.json();
      pdfContent = {
        text: parseData.data.text,
        images: parseData.data.images || [],
      };
    } catch (e) {
      return `Failed to read or parse PDF: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 3. Generate classroom (API handles persistence and returns id+url)
  try {
    const generateRes = await fetch(`${baseUrl}/api/generate-classroom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement: input.requirement,
        ...(pdfContent ? { pdfContent } : {}),
      }),
    });

    if (!generateRes.ok) {
      const err = await generateRes.json().catch(() => ({}));
      return `Failed to generate classroom: ${(err as { error?: string }).error || generateRes.statusText}`;
    }

    const data = await generateRes.json();
    return `Classroom generated successfully!\n\nURL: ${data.url}\nID: ${data.id}\nScenes: ${data.scenesCount}`;
  } catch (e) {
    return `Failed to generate classroom: ${e instanceof Error ? e.message : String(e)}`;
  }
}
