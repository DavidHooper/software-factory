import { isHumanPrompt } from './interjections.ts';
import { describe, expect, it } from './test/expect.ts';

describe('isHumanPrompt', () => {
  it.each([
    'Use branch claude/issue-2-health instead',
    'Run code-review as step 5 says, even for a small diff',
    'You run one step of the agent workflow in this repository.',
  ])('counts %s', (prompt) => {
    expect(isHumanPrompt(prompt)).toBe(true);
  });

  it.each([
    '<agent-message from="a091e5dc8cd7a8d5d"> [Subagent hand-back] The text below is the final report…',
    '<task-notification> <task-id>a091e5dc8cd7a8d5d</task-id> <status>completed</status>',
    '  \n<task-notification>\n<task-id>x</task-id>',
    '',
  ])('ignores system messages: %s', (prompt) => {
    expect(isHumanPrompt(prompt)).toBe(false);
  });
});
