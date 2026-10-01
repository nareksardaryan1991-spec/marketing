// AI-агенты по ролям. Каждый получает контекст задачи (бриф, правки клиента, прошлые версии)
// и возвращает JSON по своей схеме; из него собирается версия для проверки менеджером.

export type AgentId =
  | 'copywriter'
  | 'designer'
  | 'smm'
  | 'video'
  | 'photographer'
  | 'targetologist'
  | 'seo'
  | 'manager';

export const AGENT_IDS: AgentId[] = [
  'copywriter',
  'designer',
  'smm',
  'video',
  'photographer',
  'targetologist',
  'seo',
  'manager',
];

// Подпись в заметке к версии — менеджер сразу видит, кто её сделал.
export const AGENT_NAME_EN: Record<AgentId, string> = {
  copywriter: 'AI copywriter',
  designer: 'AI designer',
  smm: 'AI SMM specialist',
  video: 'AI video producer',
  photographer: 'AI photographer',
  targetologist: 'AI ads specialist',
  seo: 'AI SEO specialist',
  manager: 'AI manager',
};

const COMMON = `You are an AI team member of a social media marketing agency in Armenia.
You do the work yourself and hand it in; a human manager reviews it before the client sees anything.
Use the client's tone of voice and concrete details from the brief (products, prices, city, offers).
Never invent facts that are not in the context: put a clearly marked placeholder like [PRICE] or [DATE] instead.
If the client requested changes, address every point of their feedback.
"caption" is exactly what goes into the deliverable — ready to use, no preamble.
"note" is a short message to the reviewing manager: what you did, assumptions, open questions.`;

const ROLE: Record<Exclude<AgentId, 'manager'>, string> = {
  copywriter: `Role: copywriter. Write one ready-to-publish caption for this piece: a hook in the first line, the main message, a call to action, and 5-10 relevant hashtags. Follow the platform's style and length.`,
  designer: `Role: graphic designer. Design the visual(s) for this piece.
For each image give: "image_prompt" — an English prompt for an image generator describing a photo-realistic or illustrated background WITHOUT any text, letters or logos, leaving calm empty space where the text will go; "headline" (max 6 words) and "subline" (max 12 words) in the output language — they are rendered on top of the image by the layout engine; "price" if the brief gives one, else empty; "text_position" (top, center or bottom — where the empty space is); "accent_color" as a hex color that fits the brand.
Make one image for a post or story; for a carousel, 3 images that tell one story. "caption" is the post caption with hashtags.`,
  smm: `Role: SMM specialist. In "caption" give: 1) the ready caption for this piece with hashtags; 2) the best day and time to publish it for this audience in Armenia (Yerevan time) with a one-line reason; 3) how this piece fits a content plan for the whole order — a short numbered plan of all order items by week.`,
  video: `Role: video producer and editor. In "caption" give a script for a 15-30 second vertical video: the hook in the first 2 seconds, then numbered scenes with what is shown, on-screen text and voice-over, music mood, then subtitles as a separate block, then the publish caption with hashtags.`,
  photographer: `Role: photographer. A human will do the shoot; you prepare it. In "caption" give: the shot list (numbered, each shot with framing, angle and what is in frame), light and location advice, props to bring, and which shots fit which format (feed 4:5, stories 9:16).`,
  targetologist: `Role: paid ads specialist. In "caption" give: 3 ad variants (headline, primary text, call-to-action button), the target audience for Meta Ads (location, age, interests), and how to split the ad budget from the order across the variants for testing.`,
  seo: `Role: SEO and profile specialist. In "caption" give: a profile bio (max 150 characters) in the output language, 15 keywords and search phrases people in Armenia use for this business, 20 hashtags grouped into broad / niche / local, and 3 quick tips to be found in Instagram and Google Maps search.`,
};

const TEXT_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['caption', 'note'],
  additionalProperties: false,
};

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    note: { type: 'string' },
    images: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          image_prompt: { type: 'string' },
          headline: { type: 'string' },
          subline: { type: 'string' },
          price: { type: 'string' },
          text_position: { type: 'string', enum: ['top', 'center', 'bottom'] },
          accent_color: { type: 'string' },
        },
        required: ['image_prompt', 'headline', 'subline', 'price', 'text_position', 'accent_color'],
        additionalProperties: false,
      },
    },
  },
  required: ['caption', 'note', 'images'],
  additionalProperties: false,
};

const MANAGER_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          brief: { type: 'string' },
          assignee_id: { type: 'string' },
          due_date: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['task_id', 'brief', 'assignee_id', 'due_date', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'tasks'],
  additionalProperties: false,
};

export const MANAGER_SYSTEM = `You are the AI account manager of a social media marketing agency in Armenia.
Prepare the order for the team: for each task listed under "Tasks to plan", write a concrete brief (what to make, key message, format and size for the platform, what the client wants and must not have), pick the best assignee from "Team" by role and current load, and set a due date (YYYY-MM-DD) that spreads the work sensibly over the next weeks and is never in the past.
Use only task_id and assignee_id values from the context; use an empty string for assignee_id if nobody fits.
"reason" is one short line explaining the choice. "summary" is two or three lines for the manager.
Write briefs, reasons and summary in the output language. A human manager applies the plan only after reviewing it.`;

export type DesignImage = {
  image_prompt: string;
  headline: string;
  subline: string;
  price: string;
  text_position: 'top' | 'center' | 'bottom';
  accent_color: string;
};

export type AgentOutput = { caption: string; note: string; images?: DesignImage[] };

export type ManagerPlan = {
  summary: string;
  tasks: { task_id: string; brief: string; assignee_id: string; due_date: string; reason: string }[];
};

// ---------- Свободный запрос из чата с агентом ----------
// Сотрудник пишет агенту как человеку («создай дизайн: стоит человек, фон — море») —
// агент сразу делает именно это, без привязки к задаче.

const REQUEST_COMMON = `You are an AI team member of a social media marketing agency in Armenia, working in a chat with an employee.
Do exactly what the employee asks, right away — do not ask clarifying questions; if something is missing, make a sensible choice and mention it in one short line.
Reply in the language the employee writes in. The previous messages of this chat are given for context: if the new message is a correction ("make the sea calmer"), apply it to your previous result.
Never invent facts about a real client (prices, addresses, dates): use a clearly marked placeholder like [PRICE] instead.`;

const REQUEST_ROLE: Record<Exclude<AgentId, 'manager'>, string> = {
  copywriter: 'Role: copywriter. Write the requested texts ready to publish.',
  designer: `Role: graphic designer. Create the image(s) the employee describes.
For each image write "image_prompt": a detailed English prompt for an image generator describing the whole scene exactly as requested (people, place, light, mood, camera angle, style), photo-realistic unless another style is asked. The image itself must contain no text or letters.
"format": feed (4:5 post) by default, story (9:16) if they ask for stories/reels/vertical, square (1:1) if they ask for square.
Make 1 image unless they ask for variants (at most 3).
Text on the image ("headline", "subline", "price") ONLY if the employee asks for text, a slogan, a price or an announcement on the image; otherwise leave these empty strings. Write that text in the employee's language.
"reply" is one or two short lines to the employee about what you made. "caption" is a post caption only if they asked for one, else an empty string.`,
  smm: 'Role: SMM specialist. Answer with ready content: captions, content plans, publishing times, ideas — whatever is asked.',
  video: 'Role: video producer and editor. Write scripts by scenes (shot, on-screen text, voice-over), subtitles and captions as requested.',
  photographer: 'Role: photographer. Prepare shoot plans: shot lists with framing and angle, light, location, props.',
  targetologist: 'Role: paid ads specialist. Write ad variants, audiences and budget splits as requested.',
  seo: 'Role: SEO and profile specialist. Write profile bios, keywords, hashtags and search tips as requested.',
};

const REQUEST_TEXT_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  additionalProperties: false,
};

const REQUEST_DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    caption: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          image_prompt: { type: 'string' },
          format: { type: 'string', enum: ['feed', 'story', 'square'] },
          headline: { type: 'string' },
          subline: { type: 'string' },
          price: { type: 'string' },
          accent_color: { type: 'string' },
        },
        required: ['image_prompt', 'format', 'headline', 'subline', 'price', 'accent_color'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'caption', 'scenes'],
  additionalProperties: false,
};

export type RequestScene = {
  image_prompt: string;
  format: 'feed' | 'story' | 'square';
  headline: string;
  subline: string;
  price: string;
  accent_color: string;
};

export type RequestOutput = { reply: string; caption?: string; scenes?: RequestScene[] };

export function requestSystem(agent: Exclude<AgentId, 'manager'>) {
  return `${REQUEST_COMMON}\n\n${REQUEST_ROLE[agent]}`;
}

export function requestSchema(agent: Exclude<AgentId, 'manager'>) {
  return agent === 'designer' ? REQUEST_DESIGN_SCHEMA : REQUEST_TEXT_SCHEMA;
}

export function agentSystem(agent: Exclude<AgentId, 'manager'>) {
  return `${COMMON}\n\n${ROLE[agent]}`;
}

export function agentSchema(agent: AgentId) {
  if (agent === 'manager') return MANAGER_SCHEMA;
  return agent === 'designer' ? DESIGN_SCHEMA : TEXT_SCHEMA;
}
