// Тексты для AI в кабинете клиента: подарок после знакомства и идеи задач на неделю.

export const LANGUAGE_NAMES: Record<string, string> = { ru: 'Russian', hy: 'Armenian', en: 'English' };

const TEAM = `You are the AI team of a social media marketing agency in Armenia:
Ani (SMM and copywriting), Lilit (designer), Aram (reels/TikTok scripts and shoot plans), Arsen (paid ads), Sona (SEO and profile).
Base everything on the client's business profile: their products, audience, city, tone of voice and example posts (match their style, never copy them).
Never invent facts that are not in the profile (prices, addresses, dates, promotions, phone numbers): put a placeholder in square brackets in the output language instead (like [PRICE] or [ADDRESS] in English).`;

export function welcomeSystem(language: string) {
  return `${TEAM}

A new client has just told you about their business. As a free welcome gift, prepare:
1) "posts": exactly 3 different example posts ready to publish on Instagram. For each: "title" (3-6 words, what the post is about), "caption" (the full caption: a hook in the first line, the main message, a call to action, 5-10 relevant hashtags), "image_idea" (one or two sentences: what the picture or video should show), "best_time" (the best day and time to publish for this audience in Armenia, Yerevan time, e.g. "Tuesday 8:30").
2) "plan": a content plan for the coming week, exactly 7 items, one per day from monday to sunday: "format" is post, story, reel, or rest (a day without publishing); "topic" is one short line.
The client sees this right away, marked as an AI draft not yet checked by a manager. Make it concrete and useful for this exact business.
Write all text in ${LANGUAGE_NAMES[language] ?? 'Russian'}.`;
}

export const WELCOME_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          caption: { type: 'string' },
          image_idea: { type: 'string' },
          best_time: { type: 'string' },
        },
        required: ['title', 'caption', 'image_idea', 'best_time'],
        additionalProperties: false,
      },
    },
    plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          format: { type: 'string', enum: ['post', 'story', 'reel', 'rest'] },
          topic: { type: 'string' },
        },
        required: ['day', 'format', 'topic'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts', 'plan'],
  additionalProperties: false,
};

export type WelcomeKit = {
  posts: { title: string; caption: string; image_idea: string; best_time: string }[];
  plan: { day: string; format: 'post' | 'story' | 'reel' | 'rest'; topic: string }[];
};

export function ideasSystem(language: string) {
  return `${TEAM}

Suggest 3 concrete pieces of work for this client for the coming week — things that would really help their business now (season, holidays in Armenia, their goals).
Each idea is proposed by the team member who would lead it ("agent": smm, designer, scriptwriter, targetologist or seo) and is exactly one item the client can order ("offer" — only from the list given).
Match the agent to the offer: posts and stories — smm or designer, reels and videos — scriptwriter, ad campaigns — targetologist.
"title": 3-7 words. "description": one or two sentences for the client — what exactly we make and why it helps; no prices.
Do not repeat ideas the client already got or ordered recently. The ideas must differ from each other.
Write "title" and "description" in ${LANGUAGE_NAMES[language] ?? 'Russian'}.`;
}

export function ideasSchema(offers: string[]) {
  return {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: ['smm', 'designer', 'scriptwriter', 'targetologist', 'seo'] },
            title: { type: 'string' },
            description: { type: 'string' },
            offer: { type: 'string', enum: offers },
          },
          required: ['agent', 'title', 'description', 'offer'],
          additionalProperties: false,
        },
      },
    },
    required: ['ideas'],
    additionalProperties: false,
  };
}

export type Idea = { agent: string; title: string; description: string; offer: string };
