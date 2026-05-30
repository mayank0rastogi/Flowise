// @ts-nocheck
/**
 * GovernanceHITL.ts
 * ─────────────────────────────────────────────────────────────────
 * Tiny HTTP server (Node.js built-in) that pauses the agent loop for
 * human approval. Zero external dependencies.
 *
 * Flow:
 *  1. Agent calls requestApproval() → a pending entry is created,
 *     a URL is printed to the terminal, and the Promise BLOCKS.
 *  2. Human opens http://localhost:3001/approve/<id> in their browser.
 *  3. Human clicks Approve or Reject (optionally edits args).
 *  4. Browser POSTs to /decision/<id> → Promise resolves → agent continues.
 *
 * The agent thread genuinely waits — it does NOT fire the tool and ask later.
 */
import * as http from 'http'

export interface HITLResult {
    approved: boolean
    approver: string
    modifiedArgs: Record<string, unknown>
}

interface PendingRequest {
    tool: string
    args: Record<string, unknown>
    reason: string
    thought: string
    resolve: (result: HITLResult) => void
}

const _pending = new Map<string, PendingRequest>()
let _serverStarted = false

/** Generates a short unique ID without any external package */
function generateId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function ensureServer(port = 3001): void {
    if (_serverStarted) return
    _serverStarted = true

    const server = http.createServer((req, res) => {
        const url = req.url || ''

        // ── GET /approve/:id — serve the approval UI ─────────────────────
        const approveMatch = url.match(/^\/approve\/([^/?]+)/)
        if (req.method === 'GET' && approveMatch) {
            const id = approveMatch[1]
            const pending = _pending.get(id)
            if (!pending) {
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end('<h2>Request not found or already decided.</h2>')
                return
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Agent Approval Required</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0f0f12;color:#e2e2e6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
    .card{background:#1a1a22;border:1px solid #2e2e3a;border-radius:12px;max-width:640px;width:100%;padding:2rem}
    .badge{display:inline-block;padding:.25rem .75rem;border-radius:99px;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1.5rem;background:#3d2a00;color:#f59e0b;border:1px solid #78450d}
    h1{font-size:1.3rem;margin-bottom:.4rem;color:#fff}
    .sub{color:#888;font-size:.85rem;margin-bottom:2rem}
    label{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:.4rem;margin-top:1.2rem}
    .code{background:#0a0a10;border:1px solid #2e2e3a;border-radius:8px;padding:.9rem;font-family:monospace;font-size:.82rem;color:#a9c3e8;white-space:pre-wrap;word-break:break-all}
    .reason{background:#1f1a0a;border:1px solid #3d2a00;border-radius:8px;padding:.9rem;color:#f59e0b;font-size:.88rem}
    textarea{width:100%;background:#0a0a10;border:1px solid #2e2e3a;border-radius:8px;padding:.7rem;color:#a9c3e8;font-family:monospace;font-size:.82rem;min-height:110px;resize:vertical}
    input[type=text]{width:100%;background:#0a0a10;border:1px solid #2e2e3a;border-radius:8px;padding:.6rem .75rem;color:#e2e2e6;font-size:.9rem;margin-top:.4rem}
    .btns{display:flex;gap:1rem;margin-top:1.8rem}
    button{flex:1;padding:.75rem;border-radius:8px;border:none;cursor:pointer;font-size:.9rem;font-weight:700;transition:opacity .15s}
    .approve{background:#16a34a;color:#fff} .reject{background:#dc2626;color:#fff}
    button:hover{opacity:.85}
  </style>
</head>
<body>
<div class="card">
  <span class="badge">Human Approval Required</span>
  <h1>Agent wants to invoke a tool</h1>
  <p class="sub">Review, optionally edit the arguments, then approve or reject.</p>
  <label>Proposed Tool</label>
  <div class="code">${pending.tool}</div>
  <label>Arguments (editable)</label>
  <textarea id="args">${JSON.stringify(pending.args, null, 2)}</textarea>
  <label>Why Approval is Needed</label>
  <div class="reason">${pending.reason}</div>
  <label>Agent Reasoning</label>
  <div class="code">${pending.thought}</div>
  <label>Your Name</label>
  <input type="text" id="approver" value="Human Reviewer">
  <div class="btns">
    <button class="approve" onclick="decide('approve')">&#10003; Approve</button>
    <button class="reject" onclick="decide('reject')">&#10007; Reject</button>
  </div>
</div>
<script>
function decide(action){
  let args;try{args=JSON.parse(document.getElementById('args').value)}catch(e){alert('Invalid JSON: '+e.message);return}
  const approver=document.getElementById('approver').value||'Anonymous'
  fetch('/decision/${id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,approver,args})})
    .then(()=>{document.querySelector('.card').innerHTML='<div style="text-align:center;padding:3rem"><h2 style="color:'+(action==='approve'?'#4ade80':'#f87171')+'">'+(action==='approve'?'Approved':'Rejected')+'</h2><p style="color:#888;margin-top:1rem">Close this window. The agent will continue.</p></div>'})
}
</script>
</body></html>`)
            return
        }

        // ── POST /decision/:id — receive the human's decision ────────────
        const decisionMatch = url.match(/^\/decision\/([^/?]+)/)
        if (req.method === 'POST' && decisionMatch) {
            const id = decisionMatch[1]
            let body = ''
            req.on('data', (chunk) => { body += chunk.toString() })
            req.on('end', () => {
                const pending = _pending.get(id)
                if (!pending) {
                    res.writeHead(404, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ status: 'not_found' }))
                    return
                }
                try {
                    const { action, approver, args } = JSON.parse(body)
                    pending.resolve({
                        approved: action === 'approve',
                        approver: approver || 'unknown',
                        modifiedArgs: args ?? pending.args
                    })
                    _pending.delete(id)
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ status: 'ok' }))
                } catch (_e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ status: 'bad_request' }))
                }
            })
            return
        }

        res.writeHead(404)
        res.end('Not found')
    })

    server.listen(port, () => {
        console.log(`\n[Governance HITL] Approval server running at http://localhost:${port}\n`)
    })
}

/**
 * Called from inside the governance gate in AgentExecutor._call().
 * Prints the approval URL to the console and BLOCKS until the human responds.
 * The agent loop genuinely waits — it does NOT fire the tool and ask later.
 */
export async function requestApproval(
    toolName: string,
    toolArgs: Record<string, unknown>,
    reason: string,
    thought: string,
    port = 3001
): Promise<HITLResult> {
    ensureServer(port)
    const id = generateId()

    return new Promise<HITLResult>((resolve) => {
        _pending.set(id, { tool: toolName, args: toolArgs, reason, thought, resolve })
        console.log('\n' + '='.repeat(62))
        console.log('  HUMAN APPROVAL REQUIRED -- AGENT LOOP IS PAUSED')
        console.log(`  Tool    : ${toolName}`)
        console.log(`  Args    : ${JSON.stringify(toolArgs)}`)
        console.log(`  Reason  : ${reason}`)
        console.log(`  Open    : http://localhost:${port}/approve/${id}`)
        console.log('='.repeat(62) + '\n')
    })
}
