// 共用的 LINE client：index.js 用來回覆訊息，reminder.js 用來主動推播。
const line = require('@line/bot-sdk');
const { config } = require('./config');

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.line.channelAccessToken,
});

// Blob client：用來抓使用者傳來的語音／圖片等多媒體內容
const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.line.channelAccessToken,
});

// getMessageContent 回傳可能是 Readable stream 或 Blob，統一轉成 Buffer
async function getContentBuffer(messageId) {
  const content = await blobClient.getMessageContent(messageId);
  if (Buffer.isBuffer(content)) return content;
  if (content && typeof content.arrayBuffer === 'function') {
    return Buffer.from(await content.arrayBuffer());
  }
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = { line, client, blobClient, getContentBuffer };
