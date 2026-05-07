import { Sticker, StickerTypes } from 'wa-sticker-formatter'
import { WASocket, proto } from '@whiskeysockets/baileys'
import { sendSticker } from './messages'

export type StickerCrop = 'full' | 'crop' | 'circle' | 'rounded' | 'default'

export interface StickerOptions {
  /** Sticker pack name shown in WhatsApp's sticker picker. */
  pack?: string
  /** Sticker author. */
  author?: string
  /** Crop / fitting mode. Default `full`. */
  type?: StickerCrop
  /** Output webp quality 1–100. Default 60. Lower = smaller file, lower fidelity. */
  quality?: number
  /** Background color hex (e.g. `#ffffff`). Useful for transparent sources with `circle`/`rounded`. */
  background?: string
  /** Telegram-style category emojis attached to the sticker, e.g. `['😀','🎉']`. */
  categories?: string[]
  /** Sticker ID — usually leave undefined and let the lib generate. */
  id?: string
}

const TYPE_MAP: Record<StickerCrop, StickerTypes> = {
  full: StickerTypes.FULL,
  crop: StickerTypes.CROPPED,
  circle: StickerTypes.CIRCLE,
  rounded: StickerTypes.ROUNDED,
  default: StickerTypes.DEFAULT,
}

/**
 * Convert an image, GIF, or short video buffer/URL into a WhatsApp-compatible
 * `.webp` sticker buffer.
 *
 * Sources accepted:
 * - `Buffer` of image (jpg/png/webp/etc.) or short video (mp4/webm/gif).
 * - URL string (will be fetched).
 *
 * Constraints:
 * - Animated stickers must be ≤ 10 s and ≤ 500 KB after conversion (WA limit).
 * - Source video should be ≤ 6 s ideally; > 10 s gets rejected by WA on receive.
 *
 * @example
 * const webp = await toWebp(jpgBuffer, { pack: 'My Pack', author: 'Bot', type: 'full' })
 * await sendSticker(sock, jid, { sticker: webp })
 */
export async function toWebp(
  source: Buffer | string,
  options: StickerOptions = {},
): Promise<Buffer> {
  const sticker = new Sticker(source, {
    pack: options.pack ?? 'BaileysBot',
    author: options.author ?? 'Baileys',
    type: TYPE_MAP[options.type ?? 'full'],
    quality: options.quality ?? 60,
    background: options.background as `#${string}` | undefined,
    categories: options.categories as never,
    id: options.id,
  })
  return sticker.toBuffer()
}

/** Convert media to webp and send as a sticker in one call. */
export async function sendStickerFromMedia(
  sock: WASocket,
  jid: string,
  source: Buffer | string,
  options: StickerOptions & { quoted?: proto.IWebMessageInfo } = {},
) {
  const webp = await toWebp(source, options)
  return sendSticker(sock, jid, { sticker: webp, quoted: options.quoted })
}

export { Sticker, StickerTypes }
