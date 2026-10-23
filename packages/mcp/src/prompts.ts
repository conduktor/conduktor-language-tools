/** A prompt an MCP client offers its user, as a slash command in Zed's agent or a prompt in Claude Code. */
export interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  text(args: Readonly<Record<string, string | undefined>>): string;
}

const NEVER_APPLIED = 'Stop there: I apply it myself from the editor. Never say it has been applied.';

// The workflow the tools describe, as the steps a person would ask for.
export const PROMPTS: readonly Prompt[] = [
  {
    name: 'get_started',
    title: 'Get started with Conduktor',
    description: 'Write a first Conduktor resource with the agent, from what the Console accepts to a clean dry run.',
    arguments: [],
    text: () =>
      [
        'Help me write my first Conduktor resource, one step at a time, and say briefly what each step is for.',
        '1. Call conduktor_list_kinds to see what this Console accepts, and ask me what I want to create; a Topic is a good first one.',
        '2. Call conduktor_get_kind_schema for that kind, and conduktor_get_resources to show me one or two that exist already, so we follow their conventions: names, labels, cluster.',
        '3. Write the resource to a YAML file in this project.',
        '4. Call conduktor_validate and fix every error, then conduktor_dry_run and tell me what the Console says.',
        '5. If it exists already, call conduktor_diff_with_live and tell me what would change.',
        NEVER_APPLIED,
      ].join('\n'),
  },
  {
    name: 'write_resource',
    title: 'Write a Conduktor resource',
    description:
      "Write a resource of one kind, following the Console's schema and its existing resources, then dry-run it.",
    arguments: [
      { name: 'kind', description: 'The kind, for example Topic or ApplicationInstance.', required: true },
      { name: 'what', description: 'What it is for, in your words.' },
    ],
    text: ({ kind, what }) =>
      [
        `Write a Conduktor ${kind}${what ? ` for this: ${what}` : ''}.`,
        `Call conduktor_get_kind_schema for ${kind} first and follow the schema exactly, and look at existing ones with conduktor_get_resources to match their conventions.`,
        'Write it to a YAML file in this project, call conduktor_validate and fix every error, then conduktor_dry_run.',
        'Tell me what the dry run says, and what I have to set myself, such as a ${VAR}.',
        NEVER_APPLIED,
      ].join('\n'),
  },
  {
    name: 'review_changes',
    title: 'Review what applying would change',
    description:
      'Dry-run Conduktor YAML and explain, resource by resource, what applying it would change on the Console.',
    arguments: [{ name: 'path', description: 'A YAML file in the project; the one being worked on when left out.' }],
    text: ({ path }) =>
      [
        `Review what applying ${path ? `the Conduktor YAML in ${path}` : 'the Conduktor YAML I am working on'} would change.`,
        'Call conduktor_dry_run, then conduktor_diff_with_live for the resources that exist already.',
        'Tell me in plain words, resource by resource: what would be created, what changes and what stays;',
        'anything risky, such as fewer partitions, a shorter retention, a different cleanup policy, or a permission or owner removed;',
        'and anything the Console would refuse, with the fix. Do not change any file.',
      ].join('\n'),
  },
];
