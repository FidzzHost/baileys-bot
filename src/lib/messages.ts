import {
  WASocket,
  AnyMessageContent,
  proto,
  generateWAMessageFromContent,
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys'
import { logger } from '../core/logger'
import type { ParsedMessage } from './parser'

// ──────────────────────────────────────────────────────────────────────────────
// Basic sends
// ──────────────────────────────────────────────────────────────────────────────

/** Send a plain text reply. Pass `quoted` to quote the original message. */
export function reply(
  sock: WASocket,
  jid: string,
  text: string,
  quoted?: proto.IWebMessageInfo,
) {
  return sock.sendMessage(jid, { text }, { quoted })
}

/** Edit a previously-sent message (must be one the bot itself sent). */
export function editMessage(
  sock: WASocket,
  jid: string,
  key: proto.IMessageKey,
  text: string,
) {
  return sock.sendMessage(jid, { text, edit: key })
}

/** React to a message with an emoji (or '' to remove). */
export function react(sock: WASocket, key: proto.IMessageKey, emoji: string) {
  return sock.sendMessage(key.remoteJid!, { react: { text: emoji, key } })
}

/** Send an image (Buffer or URL). */
export function sendImage(
  sock: WASocket,
  jid: string,
  args: { image: Buffer | { url: string }; caption?: string; quoted?: proto.IWebMessageInfo; mentions?: string[] },
) {
  return sock.sendMessage(
    jid,
    { image: args.image, caption: args.caption, mentions: args.mentions },
    { quoted: args.quoted },
  )
}

/** Send a video (Buffer or URL). Set `gifPlayback:true` for GIF-style. */
export function sendVideo(
  sock: WASocket,
  jid: string,
  args: {
    video: Buffer | { url: string }
    caption?: string
    gifPlayback?: boolean
    ptv?: boolean
    quoted?: proto.IWebMessageInfo
    mentions?: string[]
  },
) {
  return sock.sendMessage(
    jid,
    {
      video: args.video,
      caption: args.caption,
      gifPlayback: args.gifPlayback,
      ptv: args.ptv,
      mentions: args.mentions,
    },
    { quoted: args.quoted },
  )
}

/** Send a voice note (`ptt: true`) or normal audio. */
export function sendAudio(
  sock: WASocket,
  jid: string,
  args: { audio: Buffer | { url: string }; ptt?: boolean; mimetype?: string; quoted?: proto.IWebMessageInfo },
) {
  return sock.sendMessage(
    jid,
    {
      audio: args.audio,
      ptt: args.ptt ?? false,
      mimetype: args.mimetype ?? (args.ptt ? 'audio/ogg; codecs=opus' : 'audio/mp4'),
    },
    { quoted: args.quoted },
  )
}

/** Send a document (file). */
export function sendDocument(
  sock: WASocket,
  jid: string,
  args: {
    document: Buffer | { url: string }
    mimetype: string
    fileName: string
    caption?: string
    quoted?: proto.IWebMessageInfo
  },
) {
  return sock.sendMessage(
    jid,
    {
      document: args.document,
      mimetype: args.mimetype,
      fileName: args.fileName,
      caption: args.caption,
    },
    { quoted: args.quoted },
  )
}

/** Send a sticker (must already be webp). Use `wa-sticker-formatter` to convert media. */
export function sendSticker(
  sock: WASocket,
  jid: string,
  args: { sticker: Buffer | { url: string }; quoted?: proto.IWebMessageInfo },
) {
  return sock.sendMessage(jid, { sticker: args.sticker }, { quoted: args.quoted })
}

/** Send a location. */
export function sendLocation(
  sock: WASocket,
  jid: string,
  args: { latitude: number; longitude: number; name?: string; address?: string; quoted?: proto.IWebMessageInfo },
) {
  return sock.sendMessage(
    jid,
    {
      location: {
        degreesLatitude: args.latitude,
        degreesLongitude: args.longitude,
        name: args.name,
        address: args.address,
      },
    },
    { quoted: args.quoted },
  )
}

/** Send a contact card (vCard). */
export function sendContact(
  sock: WASocket,
  jid: string,
  args: { displayName: string; phone: string; organization?: string; quoted?: proto.IWebMessageInfo },
) {
  const vcard =
    'BEGIN:VCARD\nVERSION:3.0\n' +
    `FN:${args.displayName}\n` +
    (args.organization ? `ORG:${args.organization}\n` : '') +
    `TEL;type=CELL;type=VOICE;waid=${args.phone}:+${args.phone}\n` +
    'END:VCARD'
  return sock.sendMessage(
    jid,
    { contacts: { displayName: args.displayName, contacts: [{ vcard }] } },
    { quoted: args.quoted },
  )
}

/** Send a poll. */
export function sendPoll(
  sock: WASocket,
  jid: string,
  args: { name: string; values: string[]; selectableCount?: number; quoted?: proto.IWebMessageInfo },
) {
  return sock.sendMessage(
    jid,
    { poll: { name: args.name, values: args.values, selectableCount: args.selectableCount ?? 1 } },
    { quoted: args.quoted },
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Rich messages — buttons / list / interactive
// ──────────────────────────────────────────────────────────────────────────────

export interface ButtonSpec {
  id: string
  label: string
}

export interface ListSection {
  title: string
  rows: Array<{ id: string; title: string; description?: string }>
}

/**
 * Send classic `buttonsMessage` (button v1).
 *
 * NOTE: WhatsApp deprecated this format heavily in late-2023. It usually
 * **does not render** on modern WA clients — they fall back to plain text.
 * Kept here for compatibility with older clients / WA-Business desktop.
 */
export function sendButtons(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    footer?: string
    buttons: ButtonSpec[]
    headerImage?: Buffer | { url: string }
    headerVideo?: Buffer | { url: string }
    quoted?: proto.IWebMessageInfo
  },
) {
  const buttons = args.buttons.map(b => ({
    buttonId: b.id,
    buttonText: { displayText: b.label },
    type: 1,
  }))
  // `buttonsMessage` is not in Baileys' official AnyMessageContent type any
  // more (deprecated), but the runtime still emits it correctly when supplied.
  const content = args.headerImage
    ? { image: args.headerImage, caption: args.text, footer: args.footer, buttons, headerType: 4 }
    : args.headerVideo
      ? { video: args.headerVideo, caption: args.text, footer: args.footer, buttons, headerType: 5 }
      : { text: args.text, footer: args.footer, buttons, headerType: 1 }
  return sock.sendMessage(jid, content as unknown as AnyMessageContent, { quoted: args.quoted })
}

/** Send a list message. Renders relatively reliably across most clients. */
export function sendList(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    title?: string
    footer?: string
    buttonText: string
    sections: ListSection[]
    quoted?: proto.IWebMessageInfo
  },
) {
  return sock.sendMessage(
    jid,
    {
      text: args.text,
      title: args.title,
      footer: args.footer,
      buttonText: args.buttonText,
      sections: args.sections,
      viewOnce: true,
    } as AnyMessageContent,
    { quoted: args.quoted },
  )
}

export type InteractiveButton =
  | { type: 'reply'; id: string; label: string }
  | { type: 'url'; label: string; url: string }
  | { type: 'call'; label: string; phone: string }
  | { type: 'copy'; label: string; copyCode: string }

/**
 * Send an "interactive" / native-flow message — quick-reply buttons, CTA URL,
 * CTA call, CTA copy. This is the v2 button format. Renders on most modern
 * WA Business / Beta builds. Spam = high risk of account flag.
 *
 * Optionally attach a header image / video / document.
 */
export async function sendInteractive(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    title?: string
    footer?: string
    buttons: InteractiveButton[]
    headerImage?: Buffer | { url: string }
    headerVideo?: Buffer | { url: string }
    headerDocument?: { document: Buffer | { url: string }; fileName: string; mimetype: string }
    quoted?: proto.IWebMessageInfo
  },
) {
  const nativeButtons: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] =
    args.buttons.map(b => {
      switch (b.type) {
        case 'reply':
          return {
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({ display_text: b.label, id: b.id }),
          }
        case 'url':
          return {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: b.label,
              url: b.url,
              merchant_url: b.url,
            }),
          }
        case 'call':
          return {
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({ display_text: b.label, phone_number: b.phone }),
          }
        case 'copy':
          return {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({ display_text: b.label, copy_code: b.copyCode }),
          }
      }
    })

  // Build header — an image/video/doc upload returns a Message that we splice in.
  let header: proto.Message.InteractiveMessage.IHeader | undefined
  if (args.headerImage || args.headerVideo || args.headerDocument) {
    const upload = args.headerImage
      ? await sock.sendMessage(jid, { image: args.headerImage }, { upload: true } as never).catch(() => null)
      : args.headerVideo
        ? await sock.sendMessage(jid, { video: args.headerVideo }, { upload: true } as never).catch(() => null)
        : args.headerDocument
          ? await sock
              .sendMessage(
                jid,
                {
                  document: args.headerDocument.document,
                  mimetype: args.headerDocument.mimetype,
                  fileName: args.headerDocument.fileName,
                },
                { upload: true } as never,
              )
              .catch(() => null)
          : null
    if (upload) {
      header = {
        title: args.title,
        hasMediaAttachment: true,
        imageMessage: upload.message?.imageMessage,
        videoMessage: upload.message?.videoMessage,
        documentMessage: upload.message?.documentMessage,
      }
    }
  } else if (args.title) {
    header = { title: args.title, hasMediaAttachment: false }
  }

  const interactive: proto.Message.IInteractiveMessage = {
    body: { text: args.text },
    footer: args.footer ? { text: args.footer } : undefined,
    header,
    nativeFlowMessage: { buttons: nativeButtons },
  }

  const generated = generateWAMessageFromContent(
    jid,
    {
      viewOnceMessage: {
        message: { interactiveMessage: interactive },
      },
    },
    { userJid: sock.user?.id ?? '', quoted: args.quoted },
  )
  await sock.relayMessage(jid, generated.message!, { messageId: generated.key.id! })
  return generated
}

/**
 * Mention every member of a group while displaying only `text` to readers.
 */
export async function hidetag(
  sock: WASocket,
  groupJid: string,
  text: string,
  quoted?: proto.IWebMessageInfo,
) {
  const meta = await sock.groupMetadata(groupJid)
  return sock.sendMessage(groupJid, { text, mentions: meta.participants.map(p => p.id) }, { quoted })
}

// ──────────────────────────────────────────────────────────────────────────────
// Media download helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Download media bytes from a message (image/video/audio/document/sticker).
 * Pass either the parsed message itself (uses `raw`) or a quoted reference.
 */
export async function downloadMedia(
  sock: WASocket,
  source: ParsedMessage | WAMessage,
): Promise<Buffer> {
  const wam: WAMessage = 'raw' in source ? source.raw : source
  const buf = await downloadMediaMessage(
    wam,
    'buffer',
    {},
    { logger: logger as never, reuploadRequest: sock.updateMediaMessage },
  )
  return buf as Buffer
}
