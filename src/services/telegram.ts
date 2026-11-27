import { Api, GrammyError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { uz } from '../i18n/uz.js';

export type AccessResult = { ok: true; id: number; title: string; username?: string } | { ok: false; message: string };
export interface TelegramGateway {
  verify(channel: string | number, ownerId: number): Promise<AccessResult>;
  send(channelId: number, html: string): Promise<number>;
}

export const retryOptions = {
  maxRetryAttempts: 3,
  rethrowHttpErrors: true,
  rethrowInternalServerErrors: true,
};

export function isAccessError(error: unknown): boolean {
  return error instanceof GrammyError && (error.error_code === 403 ||
    (error.error_code === 400 && /chat not found|not enough rights|need administrator|not a member|channel_private|chat_write_forbidden|user not found|participant_id_invalid/i.test(error.description)));
}

export class GrammyGateway implements TelegramGateway {
  private readonly accessApi: Api;
  private readonly publishApi: Api;
  constructor(token: string, private readonly getBotId: () => number) {
    this.accessApi = new Api(token, { timeoutSeconds: 30 });
    this.accessApi.config.use(autoRetry(retryOptions));
    // Nashr so‘rovlari noaniq tarmoq xatosidan keyin qayta yuborilmaydi.
    this.publishApi = new Api(token, { timeoutSeconds: 30 });
  }

  async verify(channel: string | number, ownerId: number): Promise<AccessResult> {
    try {
      const chat = await this.accessApi.getChat(channel);
      if (chat.type !== 'channel') return { ok: false, message: uz.notChannel };
      const [botMember, ownerMember] = await Promise.all([
        this.accessApi.getChatMember(chat.id, this.getBotId()),
        this.accessApi.getChatMember(chat.id, ownerId),
      ]);
      if (botMember.status !== 'administrator' || !botMember.can_post_messages) return { ok: false, message: uz.botNotAdmin };
      if (ownerMember.status !== 'creator') return { ok: false, message: uz.ownerRequired };
      return { ok: true, id: chat.id, title: chat.title, ...(chat.username ? { username: chat.username } : {}) };
    } catch (error) {
      if (isAccessError(error)) return { ok: false, message: uz.accessDenied };
      throw error;
    }
  }

  async send(channelId: number, html: string): Promise<number> {
    const message = await this.publishApi.sendMessage(channelId, html, {
      parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    });
    return message.message_id;
  }
}
