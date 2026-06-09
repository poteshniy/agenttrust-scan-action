# AgentTrust Security Scanner — GitHub Action

Scan SKILL.md files, MCP manifests, and source code for malware, prompt injection, tool poisoning, and 47 other threat patterns. Powered by [AgentTrust](https://agenttrust.uk). x402-native, no API keys required.

## Usage

```yaml
- name: AgentTrust Security Scan
  uses: poteshniy/agenttrust-scan-action@v1
  with:
    path: '.'
    fail_on: 'CRITICAL'
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Path to scan (file or directory) |
| `fail_on` | `CRITICAL` | Minimum level to fail: `CRITICAL`, `HIGH`, `MEDIUM` |
| `scan_skills` | `true` | Scan SKILL.md files |
| `scan_mcp` | `true` | Scan MCP manifest JSON files |
| `scan_source` | `true` | Scan source code (.js, .ts, .py, .sh) |
| `paid` | `false` | Use full paid scan (40/50 rules) |
| `api_url` | `https://agenttrust.uk` | Override for self-hosted instance |

## Outputs

| Output | Description |
|---|---|
| `worst_level` | `SAFE`, `MEDIUM`, `HIGH`, or `CRITICAL` |
| `findings_total` | Total findings across all files |
| `v_gate` | `act` or `halt` — unified gate decision |
| `result` | Full JSON summary |

## Examples

### Scan everything, fail on CRITICAL
```yaml
name: Security Scan
on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: poteshniy/agenttrust-scan-action@v1
        with:
          path: '.'
          fail_on: 'CRITICAL'
```

### Scan only skills folder, fail on HIGH
```yaml
- uses: poteshniy/agenttrust-scan-action@v1
  with:
    path: './skills'
    fail_on: 'HIGH'
    scan_source: 'false'
```

### Use scan output in next step
```yaml
- uses: poteshniy/agenttrust-scan-action@v1
  id: scan
- run: echo "Gate decision ${{ steps.scan.outputs.v_gate }}"
```

## What gets scanned

| File type | Endpoint | Rules |
|---|---|---|
| `SKILL.md` | `/v1/scan/free` | 5 rules (free) / 40 rules (paid) |
| `*.mcp.json`, `mcp_manifest.json` | `/v1/scan/mcp/free` | 3 rules (free) / 50 rules (paid) |
| `.js`, `.ts`, `.py`, `.sh` | `/v1/scan/free` | 5 rules (free) |

## Threat categories

Backdoors · Shells · Credential theft · Prompt injection · Wallet attacks · Data exfiltration · Obfuscation · MCP tool poisoning · Tool shadowing · Hidden unicode · Rug pull patterns · Supply chain · Privilege escalation · and more.

## Free vs Paid

Free tier (default): 5 rules for SKILL.md/source, 3 rules for MCP. No wallet needed.

Full scan: 40 rules for SKILL.md, 50 rules for MCP. Requires x402 USDC payment on Base ($0.015 per file). Pass private key via GitHub Secret:

```yaml
- uses: poteshniy/agenttrust-scan-action@v1
  with:
    paid: 'true'
    x402_wallet: ${{ secrets.AGENTTRUST_WALLET_KEY }}
```

## JWS Receipts

Full scan responses include cryptographically signed ACT/HALT receipts per [draft-krausz-verification-state-00](https://datatracker.ietf.org/doc/draft-krausz-verification-state/).

## License
MIT
