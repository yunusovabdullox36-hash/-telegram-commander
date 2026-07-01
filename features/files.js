// ================================================================
// File Operations — Browse, upload, download files from PC
// ================================================================
// Commands: /dir, /cd, /download, /upload, /cat
// ================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

// Current working directory (persists for bot session)
let currentDir = process.cwd();

function getCwd() { return currentDir; }
function setCwd(dir) {
  const resolved = path.resolve(currentDir, dir);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    currentDir = resolved;
    return true;
  }
  return false;
}

// ================================================================
// List directory contents
// ================================================================
function listDirectory(dirPath) {
  const target = path.resolve(currentDir, dirPath || '.');
  
  if (!fs.existsSync(target)) {
    throw new Error(`Path not found: ${target}`);
  }
  if (!fs.statSync(target).isDirectory()) {
    throw new Error(`Not a directory: ${target}`);
  }

  const entries = fs.readdirSync(target, { withFileTypes: true });
  let totalSize = 0;
  const lines = entries.map((entry) => {
    const fullPath = path.join(target, entry.name);
    let size = '';
    let type = '';
    
    if (entry.isDirectory()) {
      type = '📁';
    } else if (entry.isFile()) {
      type = '📄';
      try {
        const stat = fs.statSync(fullPath);
        size = formatSize(stat.size);
        totalSize += stat.size;
      } catch (e) { size = '?'; }
    } else {
      type = '🔗';
    }

    // Show symlink target
    let linkTarget = '';
    try {
      if (fs.lstatSync(fullPath).isSymbolicLink()) {
        linkTarget = ` → ${fs.readlinkSync(fullPath)}`;
      }
    } catch (e) {}

    return `${type} ${entry.name}${linkTarget}${size ? ' (' + size + ')' : ''}`;
  });

  const header = `📂 ${target}\n${'─'.repeat(40)}\n`;
  const total = `\n${entries.length} items | Total: ${formatSize(totalSize)}`;
  
  return header + lines.join('\n') + total;
}

// ================================================================
// Read file content
// ================================================================
function readFileContent(filePath, maxSize = 100 * 1024) {
  const target = path.resolve(currentDir, filePath);
  
  if (!fs.existsSync(target)) throw new Error(`File not found: ${target}`);
  if (fs.statSync(target).isDirectory()) throw new Error(`Is a directory: ${target}`);
  
  const size = fs.statSync(target).size;
  if (size > maxSize) {
    throw new Error(`File too large (${formatSize(size)}). Max: ${formatSize(maxSize)}`);
  }

  const content = fs.readFileSync(target, 'utf-8');
  
  // Truncate for Telegram (4096 chars max per message)
  const maxChars = 4000 - (path.basename(target).length + 10);
  if (content.length > maxChars) {
    return `📄 ${path.basename(target)} (${formatSize(size)})\n${'─'.repeat(40)}\n${content.substring(0, maxChars)}\n\n... (truncated)`;
  }
  
  return `📄 ${path.basename(target)} (${formatSize(size)})\n${'─'.repeat(40)}\n${content}`;
}

// ================================================================
// Read file as buffer (for download)
// ================================================================
function readFileBuffer(filePath) {
  const target = path.resolve(currentDir, filePath);
  if (!fs.existsSync(target)) throw new Error(`File not found: ${target}`);
  if (fs.statSync(target).isDirectory()) throw new Error(`Is a directory: ${target}`);
  return fs.readFileSync(target);
}

function getFilePath(filePath) {
  return path.resolve(currentDir, filePath);
}

// ================================================================
// Find files by name pattern
// ================================================================
function findFiles(namePattern) {
  const results = [];
  const lower = namePattern.toLowerCase();
  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 50) break;
      if (entry.isFile() && entry.name.toLowerCase().includes(lower)) {
        results.push(entry.name);
      }
    }
  } catch (e) {}
  return results;
}

// ================================================================
// Helpers
// ================================================================
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

module.exports = {
  getCwd, setCwd, listDirectory, readFileContent, readFileBuffer,
  getFilePath, findFiles, formatSize,
};
