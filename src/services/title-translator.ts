import { z } from 'zod';

const resultSchema = z.object({
  responseStatus: z.coerce.number(),
  responseData: z.object({ translatedText: z.string().trim().min(1).max(500) }),
});

export class MyMemoryTitleTranslator {
  constructor(private readonly request: typeof fetch = fetch) {}

  async translate(title: string): Promise<string> {
    let input = '';
    let bytes = 0;
    for (const character of title) {
      bytes += Buffer.byteLength(character);
      if (bytes > 500) break;
      input += character;
    }
    const endpoint = new URL('https://api.mymemory.translated.net/get');
    endpoint.search = new URLSearchParams({ q: input, langpair: 'en|uz' }).toString();
    const response = await this.request(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Tarjima xizmati javobi: HTTP ${response.status}`);
    }
    const data = resultSchema.parse(await response.json());
    if (data.responseStatus !== 200 || /[\p{Script=Cyrillic}]/u.test(data.responseData.translatedText)) {
      throw new Error('O‘zbekcha lotin yozuvida tarjima olinmadi.');
    }
    return data.responseData.translatedText.replace(/\s+/g, ' ');
  }
}
