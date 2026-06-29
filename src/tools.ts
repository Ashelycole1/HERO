import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

async function runPowerShell(cmd: string): Promise<string> {
  const { stdout } = await execAsync(`powershell -Command "${cmd.replace(/"/g, '\\"')}"`);
  return stdout.trim();
}

/**
 * Tool 1: Get System Status / Monitoring
 */
export async function getSystemStatus(): Promise<any> {
  try {
    const cpuCmd = 'Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average';
    const memCmd = 'Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | ConvertTo-Json';
    const diskCmd = 'Get-Volume | Where-Object { $_.DriveLetter -eq \'C\' } | Select-Object Size, SizeRemaining | ConvertTo-Json';
    const procCmd = 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 -Property Name, CPU | ConvertTo-Json';

    let cpu = 0;
    try {
      const cpuOut = await runPowerShell(cpuCmd);
      cpu = parseFloat(cpuOut) || 0;
    } catch {}

    let ramTotal = 16 * 1024 * 1024; // Default fallback: 16 GB
    let ramFree = 8 * 1024 * 1024;
    try {
      const memOut = await runPowerShell(memCmd);
      const memData = JSON.parse(memOut);
      ramTotal = memData.TotalVisibleMemorySize || ramTotal;
      ramFree = memData.FreePhysicalMemory || ramFree;
    } catch {}

    let diskTotal = 500 * 1024 * 1024 * 1024;
    let diskFree = 250 * 1024 * 1024 * 1024;
    try {
      const diskOut = await runPowerShell(diskCmd);
      const diskData = JSON.parse(diskOut);
      diskTotal = diskData.Size || diskTotal;
      diskFree = diskData.SizeRemaining || diskFree;
    } catch {}

    let processes: any[] = [];
    try {
      const procOut = await runPowerShell(procCmd);
      processes = JSON.parse(procOut);
      if (!Array.isArray(processes)) {
        processes = [processes];
      }
    } catch {}

    const ramUsedPercent = parseFloat((((ramTotal - ramFree) / ramTotal) * 100).toFixed(1));
    const diskUsedPercent = parseFloat((((diskTotal - diskFree) / diskTotal) * 100).toFixed(1));

    return {
      cpuLoad: cpu,
      ram: {
        totalGB: parseFloat((ramTotal / (1024 * 1024)).toFixed(1)),
        freeGB: parseFloat((ramFree / (1024 * 1024)).toFixed(1)),
        usedPercent: ramUsedPercent,
      },
      disk: {
        totalGB: parseFloat((diskTotal / (1024 * 1024 * 1024)).toFixed(1)),
        freeGB: parseFloat((diskFree / (1024 * 1024 * 1024)).toFixed(1)),
        usedPercent: diskUsedPercent,
      },
      topProcesses: processes.map((p: any) => ({
        name: p.Name,
        cpu: p.CPU ? parseFloat(p.CPU.toFixed(1)) : 0
      }))
    };
  } catch (error: any) {
    return { error: `Failed to retrieve system status: ${error.message}` };
  }
}

/**
 * Tool 2: Filesystem Manager (Read, Write, Review)
 */
export async function manageFile(args: { action: 'read' | 'write' | 'review'; filePath: string; content?: string }): Promise<any> {
  const resolvedPath = path.resolve(args.filePath);
  
  // Security boundary check
  const isSystemPath = resolvedPath.toLowerCase().includes('c:\\windows') || 
                       resolvedPath.toLowerCase().includes('c:\\program files');
  
  if (isSystemPath) {
    return { error: 'Access denied: Refusing to read or write to system paths.' };
  }

  try {
    if (args.action === 'read') {
      const data = await fs.readFile(resolvedPath, 'utf-8');
      return { success: true, content: data };
    } else if (args.action === 'write') {
      if (!args.content) {
        return { error: 'Error: content is required for file writing.' };
      }
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, args.content, 'utf-8');
      return { success: true, message: `Successfully wrote file to ${resolvedPath}` };
    } else if (args.action === 'review') {
      const data = await fs.readFile(resolvedPath, 'utf-8');
      return { success: true, content: data, message: 'File code loaded for review.' };
    }
    return { error: `Invalid file action: ${args.action}` };
  } catch (error: any) {
    return { error: `File operation failed: ${error.message}` };
  }
}

/**
 * Tool 3: Shell Command Executor
 */
export async function runCommand(args: { command: string }): Promise<any> {
  const blockedTerms = ['format', 'rmdir /s', 'rm -rf', 'del /s', 'shutdown', 'restart'];
  const lowercaseCmd = args.command.toLowerCase();
  
  if (blockedTerms.some(term => lowercaseCmd.includes(term))) {
    return { error: 'Access denied: Command contains blocked or destructive terms.' };
  }

  try {
    const { stdout, stderr } = await execAsync(args.command);
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout ? error.stdout.trim() : '',
      stderr: error.stderr ? error.stderr.trim() : ''
    };
  }
}

/**
 * List of LLM Tool Declarations
 */
export const TOOL_DECLARATIONS = [
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: 'Get real-time CPU usage %, available RAM, disk space, and top active processes on the computer.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_file',
      description: 'Read, write, or review code files in project folders on the local PC.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'review'],
            description: 'Action to perform: "read" to read files, "write" to create or edit files, and "review" to examine code.'
          },
          filePath: {
            type: 'string',
            description: 'The absolute or relative path to the file (e.g. C:/Users/ashel/Desktop/HERO/src/index.ts).'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file (required only when action is "write").'
          }
        },
        required: ['action', 'filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute shell command lines on the PC. Use to check network ports, running servers, or test outputs.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The terminal command line string to run.'
          }
        },
        required: ['command']
      }
    }
  }
];

/**
 * Tool dispatcher
 */
export async function executeTool(name: string, args: any): Promise<any> {
  if (name === 'get_system_status') {
    return await getSystemStatus();
  }
  if (name === 'manage_file') {
    return await manageFile(args);
  }
  if (name === 'run_command') {
    return await runCommand(args);
  }
  throw new Error(`Tool not found: ${name}`);
}
