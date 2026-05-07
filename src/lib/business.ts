/**
 * Business-grade message helpers — products, catalog, multi-product (MPM),
 * carousels, and the full set of native-flow buttons supported by WhatsApp.
 *
 * Reality check: WhatsApp deprecated several rich-message formats and only
 * partially supports others on third-party clients. Native-flow buttons render
 * on WA Business and modern WA Beta builds; legacy clients fall back to plain
 * text. **Spam = high risk of account flag.** Use sparingly.
 */
import {
  WASocket,
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
} from '@whiskeysockets/baileys'

// ──────────────────────────────────────────────────────────────────────────────
// Native-flow buttons — typed union covering every name WhatsApp recognises
// ──────────────────────────────────────────────────────────────────────────────

export type NativeFlowButton =
  | { name: 'quick_reply'; params: { display_text: string; id: string } }
  | { name: 'cta_url'; params: { display_text: string; url: string; merchant_url?: string } }
  | { name: 'cta_call'; params: { display_text: string; phone_number: string } }
  | { name: 'cta_copy'; params: { display_text: string; copy_code: string } }
  | { name: 'cta_reminder'; params: { display_text: string; id: string } }
  | { name: 'cta_cancel_reminder'; params: { display_text: string; id: string } }
  | { name: 'address_message'; params: { display_text: string; id: string } }
  | { name: 'send_location'; params: { display_text: string } }
  | {
      name: 'single_select'
      params: {
        title: string
        sections: Array<{
          title: string
          rows: Array<{ header?: string; title: string; description?: string; id: string }>
        }>
      }
    }
  | {
      name: 'mpm' // Multi-product message
      params: {
        product_list_headline?: string
        product_list_footer_text?: string
        header?: { title?: string; subtitle?: string; has_media_attachment?: boolean }
        core_content: {
          product_sections: Array<{
            title: string
            products: Array<{ product_id: string }>
          }>
        }
        footer?: { primary_button_text?: string; primary_button_url?: string }
        business_owner_jid: string
      }
    }
  | {
      name: 'cta_catalog'
      params: {
        thumbnail_url?: string
        business_owner_jid: string
        catalog_text?: string
      }
    }
  | { name: 'payment_info'; params: Record<string, unknown> }
  | { name: 'review_and_pay'; params: Record<string, unknown> }
  | { name: 'review_order'; params: Record<string, unknown> }
  | { name: 'payment_method'; params: Record<string, unknown> }
  | { name: 'payment_status'; params: Record<string, unknown> }
  | { name: 'automated_greeting_message_view_catalog'; params: Record<string, unknown> }
  | { name: 'galaxy_message'; params: Record<string, unknown> }
  | { name: 'wa_payment_transaction_details'; params: Record<string, unknown> }
  // Catch-all for any future / undocumented native-flow types.
  | { name: string; params: Record<string, unknown> }

export interface NativeFlowOptions {
  text: string
  title?: string
  subtitle?: string
  footer?: string
  buttons: NativeFlowButton[]
  /** Optional header media. Only one type at a time. */
  header?:
    | { type: 'image'; image: Buffer | { url: string } }
    | { type: 'video'; video: Buffer | { url: string } }
    | { type: 'document'; document: Buffer | { url: string }; fileName: string; mimetype: string }
  /** Optional message-level mentions (mention by JID). */
  mentions?: string[]
  /** Quoted reference. */
  quoted?: proto.IWebMessageInfo
  /** Wrap the interactive in `viewOnce`. Default true (looks cleaner in WA Business). */
  viewOnce?: boolean
}

/**
 * Send any combination of native-flow buttons in one message. This is the
 * "catch-all" rich-message helper — pass `quick_reply`, `cta_url`, `mpm`,
 * `single_select`, etc. in any order.
 *
 * @example Quick reply + URL + catalog button
 *   await sendNativeFlow(sock, jid, {
 *     text: 'Pilih:',
 *     footer: 'Toko ABC',
 *     buttons: [
 *       { name: 'quick_reply', params: { display_text: 'Order', id: 'ORDER' } },
 *       { name: 'cta_url', params: { display_text: 'Web', url: 'https://example.com' } },
 *       { name: 'cta_catalog', params: { business_owner_jid: '6281234567890@s.whatsapp.net' } },
 *     ],
 *   })
 */
export async function sendNativeFlow(
  sock: WASocket,
  jid: string,
  options: NativeFlowOptions,
) {
  const nativeButtons: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] =
    options.buttons.map(b => ({
      name: b.name,
      buttonParamsJson: JSON.stringify(b.params),
    }))

  // Build header (with optional media attachment).
  let header: proto.Message.InteractiveMessage.IHeader | undefined
  if (options.header) {
    let mediaPart: proto.IMessage = {}
    if (options.header.type === 'image') {
      mediaPart = await prepareWAMessageMedia(
        { image: options.header.image },
        { upload: sock.waUploadToServer },
      )
    } else if (options.header.type === 'video') {
      mediaPart = await prepareWAMessageMedia(
        { video: options.header.video },
        { upload: sock.waUploadToServer },
      )
    } else {
      mediaPart = await prepareWAMessageMedia(
        {
          document: options.header.document,
          fileName: options.header.fileName,
          mimetype: options.header.mimetype,
        },
        { upload: sock.waUploadToServer },
      )
    }
    header = {
      title: options.title,
      subtitle: options.subtitle,
      hasMediaAttachment: true,
      imageMessage: mediaPart.imageMessage ?? undefined,
      videoMessage: mediaPart.videoMessage ?? undefined,
      documentMessage: mediaPart.documentMessage ?? undefined,
    }
  } else if (options.title || options.subtitle) {
    header = {
      title: options.title,
      subtitle: options.subtitle,
      hasMediaAttachment: false,
    }
  }

  const interactive: proto.Message.IInteractiveMessage = {
    body: { text: options.text },
    footer: options.footer ? { text: options.footer } : undefined,
    header,
    nativeFlowMessage: { buttons: nativeButtons },
  }

  const inner: proto.IMessage =
    options.viewOnce === false
      ? { interactiveMessage: interactive }
      : { viewOnceMessage: { message: { interactiveMessage: interactive } } }

  const generated = generateWAMessageFromContent(jid, inner, {
    userJid: sock.user?.id ?? '',
    quoted: options.quoted,
  })
  await sock.relayMessage(jid, generated.message!, { messageId: generated.key.id! })
  return generated
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience wrappers — each is just sugar over sendNativeFlow
// ──────────────────────────────────────────────────────────────────────────────

/** Multi-product message (catalog selection). */
export function sendMultiProduct(
  sock: WASocket,
  jid: string,
  args: {
    /** Owner of the catalog — usually the bot's own JID. */
    businessOwnerJid: string
    sections: Array<{ title: string; productIds: string[] }>
    text: string
    title?: string
    subtitle?: string
    footer?: string
    buttonText?: string
    buttonUrl?: string
    quoted?: proto.IWebMessageInfo
  },
) {
  return sendNativeFlow(sock, jid, {
    text: args.text,
    title: args.title,
    subtitle: args.subtitle,
    footer: args.footer,
    buttons: [
      {
        name: 'mpm',
        params: {
          product_list_headline: args.title,
          product_list_footer_text: args.footer,
          business_owner_jid: args.businessOwnerJid,
          core_content: {
            product_sections: args.sections.map(s => ({
              title: s.title,
              products: s.productIds.map(pid => ({ product_id: pid })),
            })),
          },
          footer:
            args.buttonText && args.buttonUrl
              ? { primary_button_text: args.buttonText, primary_button_url: args.buttonUrl }
              : undefined,
        },
      },
    ],
    quoted: args.quoted,
  })
}

/** "Open catalog" CTA button. */
export function sendCatalogButton(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    businessOwnerJid: string
    thumbnailUrl?: string
    catalogText?: string
    title?: string
    footer?: string
    quoted?: proto.IWebMessageInfo
  },
) {
  return sendNativeFlow(sock, jid, {
    text: args.text,
    title: args.title,
    footer: args.footer,
    buttons: [
      {
        name: 'cta_catalog',
        params: {
          business_owner_jid: args.businessOwnerJid,
          thumbnail_url: args.thumbnailUrl,
          catalog_text: args.catalogText,
        },
      },
    ],
    quoted: args.quoted,
  })
}

/** Single-product card (legacy product message). */
export async function sendProduct(
  sock: WASocket,
  jid: string,
  args: {
    productId: string
    businessOwnerJid: string
    title: string
    description: string
    currencyCode: string
    /** Price in 1/1000 units (so $9.99 = 9990). */
    priceAmount1000: number
    /** Sale price in 1/1000 units, optional. */
    salePriceAmount1000?: number
    retailerId?: string
    url?: string
    productImageCount?: number
    productImage: Buffer | { url: string }
    bodyText?: string
    footerText?: string
    quoted?: proto.IWebMessageInfo
  },
) {
  const imagePart = await prepareWAMessageMedia(
    { image: args.productImage },
    { upload: sock.waUploadToServer },
  )

  const productMessage: proto.Message.IProductMessage = {
    product: {
      productImage: imagePart.imageMessage,
      productId: args.productId,
      title: args.title,
      description: args.description,
      currencyCode: args.currencyCode,
      priceAmount1000: args.priceAmount1000,
      salePriceAmount1000: args.salePriceAmount1000,
      retailerId: args.retailerId,
      url: args.url,
      productImageCount: args.productImageCount ?? 1,
      firstImageId: '',
    },
    businessOwnerJid: args.businessOwnerJid,
    body: args.bodyText,
    footer: args.footerText,
  }

  const generated = generateWAMessageFromContent(
    jid,
    { productMessage },
    { userJid: sock.user?.id ?? '', quoted: args.quoted },
  )
  await sock.relayMessage(jid, generated.message!, { messageId: generated.key.id! })
  return generated
}

// ──────────────────────────────────────────────────────────────────────────────
// Carousel — multiple "cards" in a single bubble
// ──────────────────────────────────────────────────────────────────────────────

export interface CarouselCard {
  /** Card body text. */
  text: string
  /** Optional card title (header). */
  title?: string
  /** Optional card footer. */
  footer?: string
  /** Optional header media (image/video). */
  header?:
    | { type: 'image'; image: Buffer | { url: string } }
    | { type: 'video'; video: Buffer | { url: string } }
  /** Buttons within this card — same NativeFlowButton union as sendNativeFlow. */
  buttons: NativeFlowButton[]
}

/**
 * Send a carousel of interactive cards. Renders as horizontal swipeable cards
 * on supported clients (WA Business / Beta).
 */
export async function sendCarousel(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    cards: CarouselCard[]
    title?: string
    footer?: string
    quoted?: proto.IWebMessageInfo
  },
) {
  const cards: proto.Message.InteractiveMessage.ICarouselMessage['cards'] = []
  for (const c of args.cards) {
    let header: proto.Message.InteractiveMessage.IHeader | undefined
    if (c.header) {
      const mediaPart =
        c.header.type === 'image'
          ? await prepareWAMessageMedia({ image: c.header.image }, { upload: sock.waUploadToServer })
          : await prepareWAMessageMedia({ video: c.header.video }, { upload: sock.waUploadToServer })
      header = {
        title: c.title,
        hasMediaAttachment: true,
        imageMessage: mediaPart.imageMessage ?? undefined,
        videoMessage: mediaPart.videoMessage ?? undefined,
      }
    } else if (c.title) {
      header = { title: c.title, hasMediaAttachment: false }
    }
    cards!.push({
      header,
      body: { text: c.text },
      footer: c.footer ? { text: c.footer } : undefined,
      nativeFlowMessage: {
        buttons: c.buttons.map(b => ({
          name: b.name,
          buttonParamsJson: JSON.stringify(b.params),
        })),
      },
    })
  }

  const interactive: proto.Message.IInteractiveMessage = {
    body: { text: args.text },
    footer: args.footer ? { text: args.footer } : undefined,
    header: args.title ? { title: args.title, hasMediaAttachment: false } : undefined,
    carouselMessage: { cards },
  }

  const generated = generateWAMessageFromContent(
    jid,
    { viewOnceMessage: { message: { interactiveMessage: interactive } } },
    { userJid: sock.user?.id ?? '', quoted: args.quoted },
  )
  await sock.relayMessage(jid, generated.message!, { messageId: generated.key.id! })
  return generated
}

// ──────────────────────────────────────────────────────────────────────────────
// Address request / location request convenience helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Ask the user to share an address. */
export function requestAddress(
  sock: WASocket,
  jid: string,
  args: { text: string; buttonLabel?: string; quoted?: proto.IWebMessageInfo },
) {
  return sendNativeFlow(sock, jid, {
    text: args.text,
    buttons: [
      {
        name: 'address_message',
        params: { display_text: args.buttonLabel ?? 'Bagikan alamat', id: 'address_message' },
      },
    ],
    quoted: args.quoted,
  })
}

/** Ask the user to share their current location. */
export function requestLocation(
  sock: WASocket,
  jid: string,
  args: { text: string; buttonLabel?: string; quoted?: proto.IWebMessageInfo },
) {
  return sendNativeFlow(sock, jid, {
    text: args.text,
    buttons: [
      { name: 'send_location', params: { display_text: args.buttonLabel ?? 'Bagikan lokasi' } },
    ],
    quoted: args.quoted,
  })
}

/** Send a reminder button (set / cancel). */
export function sendReminderButton(
  sock: WASocket,
  jid: string,
  args: {
    text: string
    label: string
    id: string
    cancel?: boolean
    quoted?: proto.IWebMessageInfo
  },
) {
  return sendNativeFlow(sock, jid, {
    text: args.text,
    buttons: [
      {
        name: args.cancel ? 'cta_cancel_reminder' : 'cta_reminder',
        params: { display_text: args.label, id: args.id },
      },
    ],
    quoted: args.quoted,
  })
}
