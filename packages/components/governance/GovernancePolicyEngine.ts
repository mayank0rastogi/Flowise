// @ts-nocheck
/**
 * GovernancePolicyEngine.ts
 *
 * Loads rules from policy.json and evaluates a proposed tool call.
 * Returns: { decision: 'allow'|'deny'|'escalate', rule: string, reason: string }
 * No external dependencies — uses only Node.js built-ins (fs, path).
 */
import * as fs from 'fs'
import * as path from 'path'

export type PolicyDecision = 'allow' | 'deny' | 'escalate'
export interface PolicyResult {
    decision: PolicyDecision
    rule: string
    reason: string
}

interface ArgCondition {
    contains_any?: string[]
    equals?: string
    starts_with?: string
    greater_than?: number
    less_than_or_equal?: number
}
interface PolicyRule {
    name: string
    match: { tool: string; args?: Record<string, ArgCondition> }
    action: PolicyDecision
    reason?: string
}
interface PolicyFile {
    version: string
    rules: PolicyRule[]
}

let _cache: PolicyFile | null = null

function loadPolicy(): PolicyFile {
    if (_cache) return _cache
    const raw = fs.readFileSync(path.join(__dirname, 'policy.json'), 'utf-8')
    _cache = JSON.parse(raw) as PolicyFile
    return _cache
}

function matchArg(argValue: unknown, cond: ArgCondition): boolean {
    if (argValue == null) return false
    const s = String(argValue)
    if (cond.contains_any && !cond.contains_any.some((k) => s.toUpperCase().includes(k.toUpperCase()))) return false
    if (cond.equals !== undefined && s !== String(cond.equals)) return false
    if (cond.starts_with && !s.toUpperCase().startsWith(cond.starts_with.toUpperCase())) return false
    if (cond.greater_than !== undefined && !(parseFloat(s) > cond.greater_than)) return false
    if (cond.less_than_or_equal !== undefined && !(parseFloat(s) <= cond.less_than_or_equal)) return false
    return true
}

export function evaluate(toolName: string, toolArgs: Record<string, unknown>): PolicyResult {
    const policy = loadPolicy()
    for (const rule of policy.rules) {
        if (rule.match.tool !== '*' && rule.match.tool !== toolName) continue
        if (rule.match.args) {
            const allMatch = Object.entries(rule.match.args).every(([k, cond]) => matchArg(toolArgs[k], cond))
            if (!allMatch) continue
        }
        return { decision: rule.action, rule: rule.name, reason: rule.reason ?? '' }
    }
    return { decision: 'deny', rule: 'fallback', reason: 'No rule matched.' }
}

export function reloadPolicy(): void { _cache = null }