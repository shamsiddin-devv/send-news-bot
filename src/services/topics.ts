export const topics = {
  ai: { label: 'Sun’iy intellekt', keywords: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'openai', 'chatgpt', 'anthropic', 'gemini', 'sun’iy intellekt', "sun'iy intellekt", 'нейросеть', 'искусственный интеллект'] },
  technology: { label: 'Raqamli texnologiyalar', keywords: ['technology', 'digital', 'tech', 'internet', 'cloud', 'texnologiya', 'raqamli', 'технологии'] },
  cybersecurity: { label: 'Kiberxavfsizlik', keywords: ['cybersecurity', 'security', 'vulnerability', 'ransomware', 'breach', 'kiberxavfsizlik', 'xavfsizlik'] },
  software: { label: 'Dasturiy ta’minot', keywords: ['software', 'developer', 'programming', 'open source', 'github', 'dastur', 'dasturlash'] },
  gadgets: { label: 'Qurilmalar', keywords: ['smartphone', 'laptop', 'chip', 'robot', 'gadget', 'iphone', 'android', 'qurilma'] },
} as const;
export type Topic = keyof typeof topics;
export const defaultTopics: Topic[] = ['ai', 'technology'];
export function isTopic(value: string): value is Topic { return Object.hasOwn(topics, value); }
export function matchesTopics(text: string, selected: readonly Topic[]): boolean {
  const normalized = text.normalize('NFKC').toLowerCase();
  return selected.some((topic) => topics[topic].keywords.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalized);
  }));
}
