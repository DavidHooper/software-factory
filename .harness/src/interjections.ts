/**
 * Claude Code delivers some system messages through the same path as human
 * prompts: sub-agent reports (`<agent-message from="…">`) and background task
 * notifications (`<task-notification>`). They aren't interjections, and
 * counting them would inflate the interjection count retros report.
 */
const SYSTEM_PROMPT = /^\s*<(agent-message|task-notification)\b/;

export function isHumanPrompt(prompt: string): boolean {
  return prompt.trim() !== '' && !SYSTEM_PROMPT.test(prompt);
}
