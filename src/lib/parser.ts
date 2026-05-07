import { proto, WAMessage, getContentType, jidNormalizedUser } from '@whiskeysockets/baileys'

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'contactsArray'
  | 'location'
  | 'liveLocation'
  | 'poll'
  | 'reaction'
  | 'buttonsResponse'
  | 'listResponse'
  | 'templateButtonReply'
  | 'interactiveResponse'
  | 'protocolEdit'
  | 'protocolDelete'
  | 'unknown'

export interface ParsedQuoted {
  kind: MessageKind
  /** the JID of the user who originally sent the quoted message */
  participant: string | undefined
  /** stanza id of the quoted message */
  id: string | undefined
  /** plain text of the quoted message (caption / body) */
  text: string
  /** raw inner IMessage of the quoted message */
  message: proto.IMessage
  /** mime type for media quotes */
  mimeType: string | undefined
  /** synthetic WAMessage useful for `downloadMediaMessage` */
  asWAMessage: WAMessage
}

export interface ParsedMessage {
  raw: WAMessage
  /** chat JID — group or DM */
  chatJid: string
  /** sender JID, normalized (in groups: the participant; in DMs: chat JID) */
  senderJid: string
  /** is this a group chat */
  isGroup: boolean
  /** message id */
  id: string
  /** plain text body, '' if none */
  text: string
  /** semantic kind of message */
  kind: MessageKind
  /** raw content-type key (image/video/conversation/etc.) */
  type: keyof proto.IMessage | undefined
  /** whether this is the bot's own message */
  fromMe: boolean
  /** unwrapped inner IMessage (after stripping ephemeral/viewOnce wrappers) */
  inner: proto.IMessage
  /** parsed quoted message, if any */
  quoted: ParsedQuoted | undefined
  /** mentioned JIDs */
  mentions: string[]
  /** mime type of attached media, if any */
  mimeType: string | undefined
  /** wrapper flags */
  isEphemeral: boolean
  isViewOnce: boolean
}

export function parse(raw: WAMessage): ParsedMessage | null {
  if (!raw.message) return null

  let isEphemeral = false
  let isViewOnce = false
  let message = raw.message

  // Unwrap nested wrappers iteratively.
  for (let i = 0; i < 4; i++) {
    if (message.ephemeralMessage?.message) {
      isEphemeral = true
      message = message.ephemeralMessage.message
      continue
    }
    if (message.viewOnceMessage?.message) {
      isViewOnce = true
      message = message.viewOnceMessage.message
      continue
    }
    if (message.viewOnceMessageV2?.message) {
      isViewOnce = true
      message = message.viewOnceMessageV2.message
      continue
    }
    if (message.viewOnceMessageV2Extension?.message) {
      isViewOnce = true
      message = message.viewOnceMessageV2Extension.message
      continue
    }
    if (message.documentWithCaptionMessage?.message) {
      message = message.documentWithCaptionMessage.message
      continue
    }
    break
  }

  const type = getContentType(message)
  const chatJid = raw.key.remoteJid ?? ''
  const isGroup = chatJid.endsWith('@g.us')
  const senderJid = jidNormalizedUser(
    isGroup ? raw.key.participant ?? chatJid : chatJid,
  )

  const text = extractText(message, type)
  const kind = classify(message, type)
  const mimeType = mimeOf(message)
  const ctxInfo = contextInfoOf(message)
  const mentions = ctxInfo?.mentionedJid ?? []

  let quoted: ParsedQuoted | undefined
  if (ctxInfo?.quotedMessage) {
    const qInner = ctxInfo.quotedMessage
    const qType = getContentType(qInner)
    quoted = {
      kind: classify(qInner, qType),
      participant: ctxInfo.participant ?? undefined,
      id: ctxInfo.stanzaId ?? undefined,
      text: extractText(qInner, qType),
      message: qInner,
      mimeType: mimeOf(qInner),
      asWAMessage: {
        key: {
          id: ctxInfo.stanzaId ?? undefined,
          remoteJid: chatJid,
          fromMe:
            ctxInfo.participant != null &&
            jidNormalizedUser(ctxInfo.participant) === senderJid &&
            (raw.key.fromMe ?? false),
          participant: ctxInfo.participant ?? undefined,
        },
        message: qInner,
      } as WAMessage,
    }
  }

  return {
    raw,
    chatJid,
    senderJid,
    isGroup,
    id: raw.key.id ?? '',
    text,
    kind,
    type,
    fromMe: raw.key.fromMe ?? false,
    inner: message,
    quoted,
    mentions,
    mimeType,
    isEphemeral,
    isViewOnce,
  }
}

function extractText(message: proto.IMessage, type: keyof proto.IMessage | undefined): string {
  if (!type) return ''
  switch (type) {
    case 'conversation':
      return message.conversation ?? ''
    case 'extendedTextMessage':
      return message.extendedTextMessage?.text ?? ''
    case 'imageMessage':
      return message.imageMessage?.caption ?? ''
    case 'videoMessage':
      return message.videoMessage?.caption ?? ''
    case 'documentMessage':
      return message.documentMessage?.caption ?? ''
    case 'buttonsResponseMessage':
      return (
        message.buttonsResponseMessage?.selectedDisplayText ??
        message.buttonsResponseMessage?.selectedButtonId ??
        ''
      )
    case 'listResponseMessage':
      return (
        message.listResponseMessage?.title ??
        message.listResponseMessage?.singleSelectReply?.selectedRowId ??
        ''
      )
    case 'templateButtonReplyMessage':
      return (
        message.templateButtonReplyMessage?.selectedDisplayText ??
        message.templateButtonReplyMessage?.selectedId ??
        ''
      )
    case 'interactiveResponseMessage': {
      const params = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
      if (!params) return ''
      try {
        const parsed = JSON.parse(params) as { id?: string; display_text?: string }
        return parsed.display_text ?? parsed.id ?? ''
      } catch {
        return ''
      }
    }
    case 'reactionMessage':
      return message.reactionMessage?.text ?? ''
    case 'pollCreationMessage':
      return message.pollCreationMessage?.name ?? ''
    case 'pollCreationMessageV3':
      return (message as proto.IMessage & { pollCreationMessageV3?: { name?: string } }).pollCreationMessageV3?.name ?? ''
    default:
      return ''
  }
}

function classify(message: proto.IMessage, type: keyof proto.IMessage | undefined): MessageKind {
  if (!type) return 'unknown'
  if (type === 'conversation' || type === 'extendedTextMessage') return 'text'
  if (type === 'imageMessage') return 'image'
  if (type === 'videoMessage') return 'video'
  if (type === 'audioMessage') return 'audio'
  if (type === 'documentMessage') return 'document'
  if (type === 'stickerMessage') return 'sticker'
  if (type === 'contactMessage') return 'contact'
  if (type === 'contactsArrayMessage') return 'contactsArray'
  if (type === 'locationMessage') return 'location'
  if (type === 'liveLocationMessage') return 'liveLocation'
  if (type === 'pollCreationMessage' || type === 'pollCreationMessageV3') return 'poll'
  if (type === 'reactionMessage') return 'reaction'
  if (type === 'buttonsResponseMessage') return 'buttonsResponse'
  if (type === 'listResponseMessage') return 'listResponse'
  if (type === 'templateButtonReplyMessage') return 'templateButtonReply'
  if (type === 'interactiveResponseMessage') return 'interactiveResponse'
  if (type === 'protocolMessage') {
    const op = message.protocolMessage?.type
    if (op === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) return 'protocolEdit'
    if (op === proto.Message.ProtocolMessage.Type.REVOKE) return 'protocolDelete'
    return 'unknown'
  }
  return 'unknown'
}

function mimeOf(message: proto.IMessage): string | undefined {
  return (
    message.imageMessage?.mimetype ??
    message.videoMessage?.mimetype ??
    message.documentMessage?.mimetype ??
    message.audioMessage?.mimetype ??
    message.stickerMessage?.mimetype ??
    undefined
  )
}

function contextInfoOf(message: proto.IMessage): proto.IContextInfo | undefined {
  return (
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.stickerMessage?.contextInfo ??
    message.contactMessage?.contextInfo ??
    message.locationMessage?.contextInfo ??
    message.liveLocationMessage?.contextInfo ??
    message.buttonsMessage?.contextInfo ??
    message.listMessage?.contextInfo ??
    message.templateMessage?.contextInfo ??
    undefined
  )
}
