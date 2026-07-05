// ================================================================
// AI Function Calling — Tools Bridge
// ================================================================
// Defines all tools/functions that AI can call to control the PC
// Used by aichat.js with OpenAI function calling
// ================================================================

const remote = require('./remote');
const files = require('./files');
const browser = require('./browser');
const github = require('./github');
const wol = require('./wakeonlan');
const fun = require('./fun');
const monitor = require('./obsidian-monitor');
const path = require('path');
const fs = require('fs');


// ================================================================
// TOOL DEFINITIONS (OpenAI function calling schema)
// ================================================================
const tools = [
  // === PC CONTROL ===
  {
    type: 'function',
    function: {
      name: 'runCommand',
      description: 'Run any shell/terminal command on the PC (PowerShell on Windows)',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to run. Use PowerShell syntax on Windows.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPCStatus',
      description: 'Get PC status: CPU, RAM, uptime, hostname, OS info',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'takeScreenshot',
      description: 'Take a screenshot of the current desktop and return it',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listProcesses',
      description: 'List running processes on the PC',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional process name filter (e.g. "chrome", "node")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'killProcess',
      description: 'Kill a process by name or PID',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Process name (e.g. "chrome") or PID number' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lockPC',
      description: 'Lock the PC workstation',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sleepPC',
      description: 'Put the PC to sleep mode',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shutdownPC',
      description: 'Shut down the PC',
      parameters: {
        type: 'object',
        properties: {
          delay: { type: 'number', description: 'Delay in seconds before shutdown (default: 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rebootPC',
      description: 'Reboot/restart the PC',
      parameters: {
        type: 'object',
        properties: {
          delay: { type: 'number', description: 'Delay in seconds before reboot (default: 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelShutdown',
      description: 'Cancel a pending shutdown or reboot',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readClipboard',
      description: 'Read the current clipboard content',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'captureWebcam',
      description: 'Capture a photo from the webcam',
      parameters: { type: 'object', properties: {} },
    },
  },

  // === FILE OPERATIONS ===
  {
    type: 'function',
    function: {
      name: 'listDirectory',
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path. Default: current directory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Read the contents of a text file',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file' },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'changeDirectory',
      description: 'Change the current working directory',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path' },
        },
        required: ['dir'],
      },
    },
  },

  // === BROWSER CONTROL ===
  {
    type: 'function',
    function: {
      name: 'openBrowser',
      description: 'Open the web browser to a specific URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open (e.g. "google.com", "github.com")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'googleSearch',
      description: 'Open Google and search for a query in the browser',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'closeBrowser',
      description: 'Close all browser windows (Chrome, Edge, etc.)',
      parameters: {
        type: 'object',
        properties: {
          browser: { type: 'string', description: 'Browser name: "chrome" or "edge"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browserStatus',
      description: 'Check if browser is running and show open processes',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browseTo',
      description: 'Quick shortcut to open popular websites (github, gmail, chatgpt, youtube, etc.)',
      parameters: {
        type: 'object',
        properties: {
          site: {
            type: 'string',
            description: 'Shortcut name or URL. Popular: github, gmail, youtube, chatgpt, claude, chat, google, stackoverflow, reddit, render, vercel, netflix, spotify, telegram',
          },
        },
        required: ['site'],
      },
    },
  },

  // === GITHUB CONTROL ===
  {
    type: 'function',
    function: {
      name: 'githubAuth',
      description: 'Check GitHub CLI authentication status',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gitStatus',
      description: 'Check git status of the current project',
      parameters: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Path to the project. Default: current directory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gitCommit',
      description: 'Git add all and commit changes with a message',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          projectPath: { type: 'string', description: 'Path to the project' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gitPush',
      description: 'Git push to remote repository',
      parameters: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Path to the project' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gitPull',
      description: 'Git pull from remote repository',
      parameters: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Path to the project' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'githubListRepos',
      description: 'List GitHub repositories',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of repos to list (default: 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'githubListIssues',
      description: 'List GitHub issues for a repository',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. "owner/repo")' },
          state: { type: 'string', description: 'Issue state: "open", "closed", "all". Default: "open"' },
          limit: { type: 'number', description: 'Max issues (default: 10)' },
        },
        required: ['repo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'githubCreateIssue',
      description: 'Create a new GitHub issue',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. "owner/repo")' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue description/body' },
        },
        required: ['repo', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'githubRepoInfo',
      description: 'Get information about a GitHub repository',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Repository name (e.g. "owner/repo")' },
        },
        required: ['repo'],
      },
    },
  },

  // === WAKE-ON-LAN & POWER ===
  {
    type: 'function',
    function: {
      name: 'preventSleep',
      description: 'Prevent the PC from going to sleep for a specified duration',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'Duration in minutes to stay awake (default: 60)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'allowSleep',
      description: 'Restore normal sleep settings (undo preventSleep)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'powerStatus',
      description: 'Check power settings, sleep timeout, MAC address, and network info',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pingHost',
      description: 'Ping a host to check if it is reachable on the network',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Hostname or IP address to ping' },
        },
        required: ['host'],
      },
    },
  },

  // === OBSIDIAN ===
  {
    type: 'function',
    function: {
      name: 'obsidianContext',
      description: 'Get the current Obsidian context (MAIN.md, AGENTS_STATUS.md)',
      parameters: { type: 'object', properties: {} },
    },
  },

  // === FUN: STICKERS & GIFS ===
  {
    type: 'function',
    function: {
      name: 'sendFunSticker',
      description: 'Send a fun sticker to Rey. Use this occasionally to make the conversation more fun and engaging! Use keywords like fire, clap, cool, 100.',
      parameters: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            description: 'Mood of the sticker: "success", "cool", "fire", "clap", "random"',
            enum: ['success', 'cool', 'fire', 'clap', 'random'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendFunEmoji',
      description: 'Send a fun emoji reaction to make the conversation lively. Use occasionally!',
      parameters: {
        type: 'object',
        properties: {
          emoji: {
            type: 'string',
            description: 'Emoji to send: "🔥", "💪", "😎", "🎉", "🚀", "🎯", "👑", "💯", "⚡", "✨"',
          },
        },
        required: ['emoji'],
      },
    },
  },

  // === MONITOR / ACTIVITY LOG ===
  {
    type: 'function',
    function: {
      name: 'getActivityLog',
      description: 'Get today PC activity summary (what has been happening on the PC)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'logToObsidian',
      description: 'Log a custom event/note to the Obsidian PC activity log',
      parameters: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event type/name' },
          details: { type: 'string', description: 'What happened — details to log' },
        },
        required: ['event', 'details'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMonitorStatus',
      description: 'Check if PC activity monitor is running',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ================================================================
// TOOL EXECUTOR — Maps tool names to actual functions
// ================================================================
async function executeTool(toolName, args) {
  switch (toolName) {
    // PC Control
    case 'runCommand':
      return await remote.runCommand(args.command);
    case 'getPCStatus':
      return JSON.stringify(await remote.getPCStatus(), null, 2);
    case 'takeScreenshot':
      return { _screenshot: true, result: 'Screenshot taken' };
    case 'listProcesses':
      return await remote.listProcesses(args.filter || null);
    case 'killProcess':
      return await remote.killProcess(args.target);
    case 'lockPC':
      await remote.lockWorkstation();
      return 'PC locked successfully';
    case 'sleepPC':
      await remote.sleepMode();
      return 'PC going to sleep...';
    case 'shutdownPC':
      return await remote.shutdownPC(args.delay || 30);
    case 'rebootPC':
      return await remote.rebootPC(args.delay || 30);
    case 'cancelShutdown':
      return await remote.cancelShutdown();
    case 'readClipboard':
      return await remote.readClipboard();
    case 'captureWebcam':
      try {
        const img = await remote.captureWebcam();
        return { _image: true, buffer: img.toString('base64'), format: 'jpg', caption: '📷 Webcam capture' };
      } catch (e) {
        return `Webcam error: ${e.message}`;
      }

    // File Operations
    case 'listDirectory':
      try {
        return files.listDirectory(args.dir || '.');
      } catch (e) {
        return `Error: ${e.message}`;
      }
    case 'readFile':
      try {
        return files.readFileContent(args.filePath);
      } catch (e) {
        return `Error: ${e.message}`;
      }
    case 'changeDirectory':
      if (files.setCwd(args.dir)) {
        return `Changed to: ${files.getCwd()}`;
      }
      return `Directory not found: ${args.dir}`;

    // Browser
    case 'openBrowser': {
      const result = await browser.openBrowser(args.url || 'https://google.com');
      return JSON.stringify(result);
    }
    case 'googleSearch': {
      const result = await browser.googleSearch(args.query);
      return JSON.stringify(result);
    }
    case 'closeBrowser': {
      const result = await browser.closeBrowser(args.browser || 'all');
      return JSON.stringify(result);
    }
    case 'browserStatus': {
      const result = await browser.browserStatus();
      return JSON.stringify(result);
    }
    case 'browseTo': {
      const result = await browser.browseTo(args.site);
      return JSON.stringify(result);
    }

    // GitHub
    case 'githubAuth': {
      const result = await github.authStatus();
      return JSON.stringify(result);
    }
    case 'gitStatus': {
      const result = await github.gitStatus(args.projectPath || process.cwd());
      return JSON.stringify(result);
    }
    case 'gitCommit': {
      const result = await github.gitCommit(args.projectPath || process.cwd(), args.message);
      return JSON.stringify(result);
    }
    case 'gitPush': {
      const result = await github.gitPush(args.projectPath || process.cwd());
      return JSON.stringify(result);
    }
    case 'gitPull': {
      const result = await github.gitPull(args.projectPath || process.cwd());
      return JSON.stringify(result);
    }
    case 'githubListRepos': {
      const result = await github.listRepos('', args.limit || 10);
      return JSON.stringify(result);
    }
    case 'githubListIssues': {
      const result = await github.listIssues(args.repo, args.state || 'open', args.limit || 10);
      return JSON.stringify(result);
    }
    case 'githubCreateIssue': {
      const result = await github.createIssue(args.repo, args.title, args.body || '');
      return JSON.stringify(result);
    }
    case 'githubRepoInfo': {
      const result = await github.repoInfo(args.repo);
      return JSON.stringify(result);
    }

    // Power Management
    case 'preventSleep': {
      const result = await wol.preventSleep(args.minutes || 60);
      return JSON.stringify(result);
    }
    case 'allowSleep': {
      const result = await wol.allowSleep();
      return JSON.stringify(result);
    }
    case 'powerStatus': {
      const result = await wol.powerStatus();
      return JSON.stringify(result);
    }
    case 'pingHost': {
      const result = await wol.ping(args.host);
      return JSON.stringify(result);
    }

    // Obsidian
    case 'obsidianContext': {
      const vaultRoot = process.env.VAULT_PATH || 'C:\\Users\\user\\OneDrive\\Документы\\Obsidian Vault';
      const mainMd = path.join(vaultRoot, '_Miya', 'MAIN.md');
      const statusMd = path.join(vaultRoot, '_Miya', 'AGENTS_STATUS.md');
      let result = '=== MAIN.md ===\n';
      try { result += fs.readFileSync(mainMd, 'utf-8').substring(0, 3000); } catch (e) { result += '(not found)\n'; }
      result += '\n\n=== AGENTS_STATUS.md ===\n';
      try { result += fs.readFileSync(statusMd, 'utf-8').substring(0, 2000); } catch (e) { result += '(not found)\n'; }
      return result;
    }

    // === FUN STICKERS & EMOJIS ===
    case 'sendFunSticker': {
      const mood = args.mood || 'random';
      // Fallback to emoji since we don't have real sticker IDs yet
      const emojiMap = { success: '✅', cool: '😎', fire: '🔥', clap: '👏', random: '🎉' };
      return { _funEmoji: emojiMap[mood] || '🎉', message: 'Fun reaction sent!' };
    }
    case 'sendFunEmoji': {
      return { _funEmoji: args.emoji, message: `Sent ${args.emoji}` };
    }

    // === MONITOR / ACTIVITY LOG ===
    case 'getActivityLog': {
      return monitor.getTodaySummary();
    }
    case 'logToObsidian': {
      await monitor.logEvent(args.event, args.details);
      return `Logged: ${args.event} — ${args.details}`;
    }
    case 'getMonitorStatus': {
      return JSON.stringify(monitor.getMonitorStatus(), null, 2);
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ================================================================
// SYSTEM PROMPT — Tells AI how to behave
// ================================================================
const SYSTEM_PROMPT = `You are Rey's AI assistant running on his laptop. You control his PC via Telegram.

**RULES:**
1. You have FULL control of the PC. Use tools to run commands, browse, manage GitHub, etc.
2. Be concise and friendly. Reply in Uzbek (or Russian/English if asked).
3. Always explain what you're doing before executing actions.
4. For dangerous actions (shutdown, reboot, sleep, kill process) - ask for confirmation first.
5. You can open Chrome, search Google, browse websites.
6. You can run git commands, manage GitHub repos, create issues.
7. You can prevent the PC from sleeping to keep it awake.
8. You can read/write files.
9. You can take screenshots and read clipboard.
10. When asked about system status - use getPCStatus tool.
11. **BE FUN!** Occasionally (not always, about 15-20% of the time) send a fun emoji or sticker using sendFunEmoji or sendFunSticker. Make conversation engaging! Use 🔥, 💪, 🚀, 😎, 🎉, 👑, 💯 when appropriate.
12. **LOG TO OBSIDIAN** when you do something significant (run a command, open a website, make a change) using logToObsidian tool so everything is recorded.

**ABOUT REY:**
- Rey is a full-stack developer
- Projects: Hospital System, VitaCare, CardLab, Agent Room
- Uses: Node.js, Express, MongoDB, React, Vite, Tailwind
- Obsidian Vault for knowledge management
- Uzbek tilida gaplashadi

**PERSONALITY:**
- Professional but friendly
- Occasionally fun and playful
- Use stickers and emojis to make the conversation lively
- But don't overdo it — only sometimes!

**AVAILABLE ACTIONS:**
You have access to tools for: PC control (commands, processes, shutdown), file operations, browser automation, GitHub management, power management, Obsidian vault access, fun stickers/emojis, activity logging.`;

module.exports = { tools, executeTool, SYSTEM_PROMPT };
