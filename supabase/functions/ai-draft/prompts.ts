export type DraftKind = 'caption' | 'ideas' | 'reel_script' | 'content_plan';

export const DRAFT_KINDS: DraftKind[] = ['caption', 'ideas', 'reel_script', 'content_plan'];

const LANGUAGE_NAMES = { ru: 'Russian', hy: 'Armenian', en: 'English' } as const;
export type DraftLanguage = keyof typeof LANGUAGE_NAMES;

export const SYSTEM_PROMPT = `You are a senior social media copywriter at a marketing agency in Armenia.
You write drafts for the agency's team; a human editor always reviews your draft before the client sees it.

Write for the client's audience and in the client's tone of voice as described in the brief.
Be concrete: use details from the brief (products, city, offers) rather than generic marketing phrases.
If the brief lacks something you need (a price, a date, an address), leave a clearly marked placeholder like [PRICE] instead of inventing it.
Return only the requested content, ready to paste, with no preamble or closing remarks.`;

const TASKS: Record<DraftKind, string> = {
  caption:
    'Write one ready-to-publish caption for this post. Include a short hook in the first line, the main message, a call to action, and 5-10 relevant hashtags at the end.',
  ideas:
    'Suggest 5 distinct ideas for this piece of content. For each idea: a one-line title, what is shown (visual), and the key message. Number them.',
  reel_script:
    'Write a script for a 15-30 second vertical reel: a hook for the first 2 seconds, then scene-by-scene shots with on-screen text and voice-over, and a caption with hashtags.',
  content_plan:
    "Draft a content plan for this client's whole order (all items listed under Order). For each item give: number, format, topic, key message, and a suggested week of the month. Present it as a numbered list.",
};

export type BriefContext = {
  business: Record<string, string | null>;
  serviceName: string;
  platform: string | null;
  taskNumber: number;
  orderItems: string[];
  orderNotes: string | null;
  taskBrief: string | null;
  previousCaption: string | null;
  comments: string[];
};

function section(title: string, body: string | null | undefined) {
  return body ? `## ${title}\n${body}\n` : '';
}

export function buildUserPrompt(
  kind: DraftKind,
  language: DraftLanguage,
  ctx: BriefContext,
  instructions: string | null,
): string {
  const b = ctx.business;
  const businessLines = [
    ['Name', b.name],
    ['Industry', b.industry],
    ['City', b.city],
    ['About', b.description],
    ['Customers', b.target_audience],
    ['Tone of voice', b.tone],
    ['Goals', b.goals],
    ['Competitors / references', b.competitors],
    ['Instagram', b.instagram_url],
    ['Website', b.website_url],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');

  return [
    section('Client business', businessLines),
    section('Order', ctx.orderItems.map((line) => `- ${line}`).join('\n')),
    section('Client notes for the order', ctx.orderNotes),
    section(
      'This task',
      `${ctx.platform ? `${ctx.platform} ` : ''}${ctx.serviceName} #${ctx.taskNumber}` +
        (ctx.platform ? `\nWrite it for ${ctx.platform}: follow that platform's format, length and style.` : ''),
    ),
    section('Manager brief for this task', ctx.taskBrief),
    section('Previous version', ctx.previousCaption),
    section('Feedback on previous versions', ctx.comments.map((c) => `- ${c}`).join('\n')),
    section('Extra instructions from the editor', instructions),
    `## What to write\n${TASKS[kind]}\n\nWrite in ${LANGUAGE_NAMES[language]}.`,
  ]
    .filter(Boolean)
    .join('\n');
}
