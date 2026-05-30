// @ts-nocheck
/**
 * GovernanceAuditLogger.ts
 * Append-only JSON Lines log. One entry per agent step.
 * A judge can open audit.jsonl and reconstruct the full run.
 * No external dependencies — uses only Node.js built-ins (fs, path).
 */
import * as fs from 'fs'
import * as path from 'path'

export type Outcome = 'tool_executed' | 'tool_blocked' | 'tool_executed_after_approval' | 'tool_rejected_by_human'
export interface HumanDecision { approved: boolean; approver: string; modifiedArgs: Record<string, unknown> }
export interface AuditEntry {
    timestamp: string; runId: string; step: number; agentThought: string
    proposedTool: string; proposedArgs: Record<string, unknown>
    policy: { decision: string; ruleMatched: string; reason: string }
    humanDecision: HumanDecision | null
    finalOutcome: Outcome; observation: string
}

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'governance-audit-logs')
const LOG_FILE = path.join(LOG_DIR, 'audit.jsonl')

export function logEvent(entry: AuditEntry): void {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8')
}

export function getLogFilePath(): string { return LOG_FILE }