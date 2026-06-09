const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const https = require('https');

const API_URL = core.getInput('api_url') || 'https://agenttrust.uk';
const FAIL_ON = (core.getInput('fail_on') || 'CRITICAL').toUpperCase();
const SCAN_SKILLS = core.getInput('scan_skills') !== 'false';
const SCAN_MCP = core.getInput('scan_mcp') !== 'false';
const SCAN_SOURCE = core.getInput('scan_source') !== 'false';
const PAID = core.getInput('paid') === 'true';
const SCAN_PATH = core.getInput('path') || '.';

const LEVEL_RANK = { SAFE: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// File patterns
const SKILL_PATTERNS = ['SKILL.md', 'skill.md'];
const MCP_PATTERNS = [/mcp[._-]?manifest\.json$/i, /\.mcp\.json$/i, /mcp_config\.json$/i];
const SOURCE_PATTERNS = ['.js', '.ts', '.mjs', '.cjs', '.py', '.sh', '.bash'];
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'vendor'];

function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_URL);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'agenttrust-scan-action/1.0',
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, files);
    else files.push(full);
  }
  return files;
}

function classifyFile(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (SCAN_SKILLS && SKILL_PATTERNS.includes(base)) return 'skill';
  if (SCAN_MCP && MCP_PATTERNS.some(p => p instanceof RegExp ? p.test(base) : base === p)) return 'mcp';
  if (SCAN_SOURCE && SOURCE_PATTERNS.includes(ext)) return 'source';
  return null;
}

async function scanSkill(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const endpoint = PAID ? '/v1/scan' : '/v1/scan/free';
  // Free tier: max 50 lines
  const lines = content.split('\n').slice(0, PAID ? undefined : 50).join('\n');
  const result = await post(endpoint, { content: lines });
  return { file: filePath, type: 'skill', ...result };
}

async function scanMCP(filePath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { file: filePath, type: 'mcp', ok: false, error: 'Invalid JSON', level: 'SAFE', score: 0, findings: [] };
  }
  const endpoint = PAID ? '/v1/scan/mcp' : '/v1/scan/mcp/free';
  const result = await post(endpoint, { manifest });
  return { file: filePath, type: 'mcp', ...result };
}

async function scanSource(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length > 100 * 1024) {
    core.debug(`Skipping ${filePath} — too large (${content.length} bytes)`);
    return null;
  }
  const lines = content.split('\n').slice(0, PAID ? undefined : 50).join('\n');
  const result = await post('/v1/scan/free', { content: lines });
  return { file: filePath, type: 'source', ...result };
}

async function run() {
  try {
    core.info(`AgentTrust Security Scanner`);
    core.info(`API: ${API_URL} | Mode: ${PAID ? 'paid' : 'free'} | Fail on: ${FAIL_ON}`);
    core.info(`Scanning: ${SCAN_PATH}`);

    // Collect files
    const allFiles = walkDir(SCAN_PATH);
    const toScan = allFiles
      .map(f => ({ file: f, type: classifyFile(f) }))
      .filter(f => f.type !== null);

    if (toScan.length === 0) {
      core.info('No scannable files found.');
      core.setOutput('result', JSON.stringify({ files: 0, findings_total: 0, worst_level: 'SAFE', v_gate: 'act' }));
      core.setOutput('worst_level', 'SAFE');
      core.setOutput('findings_total', '0');
      core.setOutput('v_gate', 'act');
      return;
    }

    core.info(`Found ${toScan.length} file(s) to scan`);

    const results = [];
    let worstLevel = 'SAFE';
    let findingsTotal = 0;

    for (const { file, type } of toScan) {
      core.info(`  scanning ${type}: ${file}`);
      try {
        let result;
        if (type === 'skill') result = await scanSkill(file);
        else if (type === 'mcp') result = await scanMCP(file);
        else result = await scanSource(file);

        if (!result) continue;
        results.push(result);

        const level = result.level || 'SAFE';
        const findings = (result.findings || []).length;
        findingsTotal += findings;

        if (LEVEL_RANK[level] > LEVEL_RANK[worstLevel]) worstLevel = level;

        // Log findings
        const icon = level === 'SAFE' ? '✅' : level === 'MEDIUM' ? '⚠️' : level === 'HIGH' ? '🔶' : '🚨';
        core.info(`    ${icon} ${level} (score: ${result.score ?? 'N/A'}, findings: ${findings})`);

        if (findings > 0 && result.findings) {
          for (const f of result.findings.slice(0, 5)) {
            core.warning(`    [${f.id}] ${f.desc} — ${f.cat}${f.line ? ` (line ${f.line})` : ''}${f.field ? ` (field: ${f.field})` : ''}`, {
              file,
              title: `AgentTrust: ${f.desc}`,
            });
          }
        }

        // Rate limit buffer
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        core.warning(`Failed to scan ${file}: ${err.message}`);
      }
    }

    // Summary
    const vGate = LEVEL_RANK[worstLevel] >= LEVEL_RANK['MEDIUM'] ? 'halt' : 'act';
    const summary = {
      files_scanned: results.length,
      findings_total: findingsTotal,
      worst_level: worstLevel,
      v_gate: vGate,
      results: results.map(r => ({
        file: r.file,
        type: r.type,
        level: r.level,
        score: r.score,
        findings: (r.findings || []).length,
      })),
    };

    core.setOutput('result', JSON.stringify(summary));
    core.setOutput('worst_level', worstLevel);
    core.setOutput('findings_total', String(findingsTotal));
    core.setOutput('v_gate', vGate);

    // Summary table in GitHub Actions UI
    core.summary
      .addHeading('AgentTrust Scan Results')
      .addTable([
        [{ data: 'File', header: true }, { data: 'Type', header: true }, { data: 'Level', header: true }, { data: 'Findings', header: true }],
        ...results.map(r => [
          r.file.replace(SCAN_PATH, '.'),
          r.type,
          r.level || 'SAFE',
          String((r.findings || []).length),
        ]),
        [{ data: 'TOTAL', header: true }, '', { data: worstLevel, header: true }, { data: String(findingsTotal), header: true }],
      ])
      .addRaw(`\n**v_gate: ${vGate.toUpperCase()}** — powered by [AgentTrust](https://agenttrust.uk)`)
      .write();

    core.info(`\nSummary: ${results.length} files, ${findingsTotal} findings, worst: ${worstLevel}, gate: ${vGate}`);

    // Fail check
    if (LEVEL_RANK[worstLevel] >= LEVEL_RANK[FAIL_ON]) {
      core.setFailed(`AgentTrust: ${worstLevel} threat detected in ${results.filter(r => LEVEL_RANK[r.level] >= LEVEL_RANK[FAIL_ON]).length} file(s). Set fail_on to a lower level to allow this.`);
    } else {
      core.info(`✅ All files passed threshold (${FAIL_ON}).`);
    }

  } catch (err) {
    core.setFailed(`AgentTrust action failed: ${err.message}`);
  }
}

run();
