import { Request, Response } from "express";

import dotenv from "dotenv";
import { ethers } from "ethers";
import axios from "axios";
import { createClient } from "redis";
import { Telegraf } from "telegraf";
import express from "express";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NILLION_USER_ID = process.env.NILLION_USER_ID;
const NILLION_API_BASE_URL = "https://nillion-storage-apis-v0.onrender.com";

if (!BOT_TOKEN || !NILLION_USER_ID) {
  throw new Error("Please define required environment variables in .env");
}

const bot = new Telegraf(BOT_TOKEN);

const client = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 13744),
  },
});

client.on("error", (err: any) => console.log("Redis Client Error", err));

let totalMembers = 0;
const agreedUsers = new Set();

// Define the structure of wallet information
interface WalletInfo {
  address: string;
  privateKey: string;
}

// In-memory chat history storage with enhanced structure
interface TextEntity {
  type: string;
  text: string;
}

interface ChatMessage {
  id: number;
  type: string;
  date: string;
  date_unixtime: string;
  from: string;
  from_id: string;
  text: string;
  text_entities: TextEntity[];
}

interface ChatHistory {
  [chatId: string]: {
    name: string;
    type: string;
    id: number;
    messages: ChatMessage[];
  };
}

const chatHistory: ChatHistory = {};

bot.use(async (ctx: any, next: any) => {
  const chatId = ctx.chat?.id.toString();
  const chatName = ctx.chat?.title || ctx.chat?.username || "Unknown Chat";
  const chatType = ctx.chat?.type || "unknown";

  if (!chatId || !ctx.message) return next();

  // Initialize chat history if not already present
  if (!chatHistory[chatId]) {
    chatHistory[chatId] = {
      name: chatName,
      type: chatType,
      id: ctx.chat.id,
      messages: [],
    };
  }

  // Prepare the message entity
  const messageId = ctx.message.message_id;
  const date = new Date(ctx.message.date * 1000);
  const dateIso = date.toISOString();
  const dateUnix = ctx.message.date.toString();
  const fromName =
    ctx.message.from?.username ||
    `${ctx.message.from?.first_name} ${ctx.message.from?.last_name}`;
  const fromId = `user${ctx.message.from?.id}`;
  const text = ctx.message.text || "";
  const textEntities: TextEntity[] = [{ type: "plain", text }];

  // Store the message
  chatHistory[chatId].messages.push({
    id: messageId,
    type: "message",
    date: dateIso,
    date_unixtime: dateUnix,
    from: fromName,
    from_id: fromId,
    text,
    text_entities: textEntities,
  });

  // Optional: Limit history size
  if (chatHistory[chatId].messages.length > 1000) {
    chatHistory[chatId].messages = chatHistory[chatId].messages.slice(-1000);
  }

  return next();
});

function generateChatHistoryPayload(chatId: string) {
  const chatData = chatHistory[chatId];

  if (!chatData) {
    return null;
  }

  return {
    name: chatData.name,
    type: chatData.type,
    id: chatData.id,
    messages: chatData.messages,
  };
}

bot.command("exporthistory", async (ctx: any) => {
  const chatId = ctx.chat?.id.toString();

  if (!chatId || !chatHistory[chatId]) {
    await ctx.reply("No chat history found for this chat.");
    return;
  }

  const payload = generateChatHistoryPayload(chatId);

  if (payload) {
    const payloadString = JSON.stringify(payload, null, 2);
    console.log("Exported Chat History:", payloadString);
    await ctx.reply(
      `Chat history exported:\n\`\`\`\n${payloadString}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply("Failed to generate chat history payload.");
  }
});

bot.command("sendhistory", async (ctx: any) => {
  const chatId = ctx.chat?.id.toString();

  if (!chatId || !chatHistory[chatId]) {
    await ctx.reply("No chat history found for this chat.");
    return;
  }

  const payload = generateChatHistoryPayload(chatId);

  if (!payload) {
    await ctx.reply("Failed to generate chat history payload.");
    return;
  }
});

async function createWalletForChat(chatId: string, appId: string) {
  if (!appId || !NILLION_USER_ID) {
    throw new Error("App ID is required to create a wallet");
  }

  const wallet = ethers.Wallet.createRandom();

  console.log(`Created wallet for chat ${chatId}: ${wallet.address}`);
  await storePrivateKey(appId, NILLION_USER_ID, wallet.privateKey);

  return {
    address: wallet.address,
  };
}

// First, let's define an interface for our chat data structure
interface ChatData {
  chatId: string;
  walletAddress?: string;
  nillionId?: string;
  completedData?: boolean;
  requestData?: {
    location?: string;
    startDate?: number;
    endDate?: number;
    numberOfGuests?: number;
    numberOfRooms?: number;
    features?: string[];
    budgetPerPerson?: number;
    currency?: string;
  };
}

// TODO: add wallet creation
bot.start(async (ctx: any) => {
  const chatId = ctx.chat?.id.toString();
  const userId = ctx.from?.id;

  try {
    // Get existing data or initialize new
    const existingDataStr = await client.get(chatId);
    let chatData: ChatData = existingDataStr
      ? JSON.parse(existingDataStr)
      : { chatId };

    const appId = existingDataStr ? chatData.nillionId : await registerAppId();
    chatData.nillionId = appId;

    const privateKey = await retrievePrivateKey(appId, NILLION_USER_ID);

    if (!privateKey && appId) {
      const wallet = await createWalletForChat(chatId, appId);
      chatData.walletAddress = wallet.address;
    }
    // Store the updated data
    await client.set(chatId, JSON.stringify(chatData));

    const existingChatIds = await client.get("all-chat-ids");
    let chatIds = existingChatIds ? JSON.parse(existingChatIds) : [];

    // Only add the chatId if it's not already in the list
    if (!chatIds.includes(chatId)) {
      chatIds.push(chatId);
      await client.set("all-chat-ids", JSON.stringify(chatIds));
    }

    ctx.reply(`Chat initialized with ID: ${chatId}`);
  } catch (error) {
    console.error("Initialization failed:", error);
    ctx.reply("Failed to initialize chat");
  }
});

bot.command("book", (ctx: any) => {
  const messageText = ctx.message?.text;

  if (messageText) {
    const argsString = messageText.replace("/book", "").trim();
    const args = parseArguments(argsString);

    if (!args.location || !args.nights || !args.budget || !args.dates) {
      ctx.reply(
        "Please provide booking details in this format:\n" +
          "`/book location=<Location> nights=<Number> budget=<Amount> dates=<Start Date>-<End Date>`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    ctx.reply(
      `Booking details:\n` +
        `- Location: ${args.location}\n` +
        `- Nights: ${args.nights}\n` +
        `- Budget: $${args.budget}\n` +
        `- Dates: ${args.dates}` +
        `Please respond with ✅ if you agree to this trip.`
    );
  }
});

// NILLION
async function registerAppId() {
  try {
    const response = await axios.post(
      `${NILLION_API_BASE_URL}/api/apps/register`
    );

    if (response.status === 200 && response.data.app_id) {
      const appId = response.data.app_id;
      console.log(`Registered new App ID: ${appId}`);
      return appId;
    } else {
      console.error("Failed to register App ID:", response.data);
      return null;
    }
  } catch (error) {
    console.error("Error registering App ID:", error);
    throw new Error("Failed to register App ID with Nillion");
  }
}

async function storePrivateKey(
  appId: string,
  userSeed: string,
  privateKey: string
) {
  try {
    const response = await axios.post(
      `${NILLION_API_BASE_URL}/api/apps/${appId}/secrets`,
      {
        secret: {
          nillion_seed: userSeed,
          secret_value: privateKey,
          secret_name: "wallet_private_key",
        },
        permissions: {
          retrieve: [],
          update: [],
          delete: [],
          compute: {},
        },
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.status === 200) {
      console.log(`Private key stored successfully for App ID: ${appId}`);
    } else {
      console.error(`Failed to store private key: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error storing private key in Nillion:", error);
    throw new Error("Nillion storage error");
  }
}
async function retrievePrivateKey(appId: string, userSeed: string) {
  try {
    const storeIdsResponse = await axios.get(
      `${NILLION_API_BASE_URL}/api/apps/${appId}/store_ids`,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const storeIdsData = storeIdsResponse.data;

    if (
      !storeIdsData ||
      !storeIdsData.store_ids ||
      storeIdsData.store_ids.length === 0
    ) {
      console.error("No store IDs found for the App ID:", appId);
      return null;
    }

    const { store_id, secret_name } = storeIdsData.store_ids[0];

    const secretResponse = await axios.get(
      `${NILLION_API_BASE_URL}/api/secret/retrieve/${store_id}`,
      {
        params: {
          retrieve_as_nillion_user_seed: userSeed,
          secret_name: secret_name,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const secretData = secretResponse.data;

    if (secretData && secretData.secret) {
      console.log("Private key retrieved successfully:", secretData.secret);
      return secretData.secret;
    } else {
      console.error("Failed to retrieve the secret:", secretData);
      return null;
    }
  } catch (error) {
    console.error("Error retrieving private key from Nillion:", error);
    return null;
  }
}

bot.command("getkey", async (ctx: any) => {
  const chatId = ctx.chat.id.toString();

  const existingDataStr = await client.get(chatId);
  let chatData: ChatData = existingDataStr
    ? JSON.parse(existingDataStr)
    : { chatId };

  const walletInfo = chatData.walletAddress;

  if (!walletInfo) {
    await ctx.reply(
      "No wallet has been created for this chat yet. Use /start to create one."
    );
    return;
  }

  if (!chatData.nillionId) {
    await ctx.reply("No Nillion ID found for this chat.");
    return;
  }

  const privateKey = await retrievePrivateKey(
    chatData.nillionId,
    NILLION_USER_ID
  );

  if (privateKey) {
    await ctx.reply(`The private key for this chat is:\n${privateKey}`);
  } else {
    await ctx.reply("Failed to retrieve the private key.");
  }
});

// listen for messages
bot.on("text", async (ctx: any) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const messageText = ctx.message?.text;
  const isFromBot = ctx.from.is_bot;

  console.log(isFromBot);

  console.log(messageText);

  if (messageText === "funding is complete.") {
    ctx.reply(`funding complete for chat ${chatId}`);
  }

  //send data to agent backend
  //if response has completeData = true then store the result data in redis
  // await client.set('key', 'value');

  if (messageText === "redis test") {
    try {
      // First, check if we have existing data
      const chatIdString = chatId?.toString();
      const existingDataStr = await client.get(chatIdString);

      console.log({ existingDataStr });
      let chatData: ChatData = existingDataStr
        ? JSON.parse(existingDataStr)
        : { chatIdString };

      // Update with new data
      chatData = {
        ...chatData,
        walletAddress: "0x35E38E69Ae9b11b675f2062b3D4E9FFB5ef756AC", // Your wallet address
        nillionId: chatData.nillionId,
        completedData: true,
        requestData: {
          location: "Chiang Mai",
          startDate: 0,
          endDate: 0,
          numberOfGuests: 4,
          numberOfRooms: 2,
          features: ["Wi-Fi", "swimming pool"],
          budgetPerPerson: 0.1,
          currency: "USD",
        },
      };

      // Store the merged data
      await client.set(chatIdString, JSON.stringify(chatData));
    } catch (error) {
      console.error("Redis operation failed:", error);
      ctx.reply("Failed to store/retrieve data");
    }
  }

  // if (messageText === "✅") {
  //   if (!agreedUsers.has(userId)) {
  //     agreedUsers.add(userId);
  //     ctx.reply(`User ${ctx.from.first_name} has agreed to the trip!`);

  //     // Check if all users have agreed
  //     if (agreedUsers.size >= totalMembers) {
  //       ctx.reply(
  //         "All members have agreed to the trip! 🎉 Booking will proceed now."
  //       );
  //       // add booking logic
  //     }
  //   } else {
  //     ctx.reply("You have already responded with ✅.");
  //   }
  // }
});

// Function to handle messages
async function handleBotMessage(ctx: any, text: string) {
  const chatId = ctx.chat?.id;

  if (!chatId) {
    console.log("No chat ID found");
    return;
  }

  console.log(`Processing message: "${text}" in chat ${chatId}`);

  if (text.toLowerCase().includes("funding is complete")) {
    console.log("Funding complete detected");
    await ctx.reply("working");
    // await handleFundingComplete(ctx);
  }

  if (text.toLowerCase().includes("withdrawal processed")) {
    console.log("Withdrawal detected");
    // await handleWithdrawal(ctx);
  }
}

function parseArguments(args: string): {
  location?: string;
  nights?: number;
  budget?: number;
  dates?: string;
} {
  const argPairs = args.split(" ");
  const argsObj: {
    location?: string;
    nights?: number;
    budget?: number;
    dates?: string;
  } = {};

  argPairs.forEach((pair) => {
    const [key, value] = pair.split("=");
    switch (key) {
      case "location":
        argsObj.location = value;
        break;
      case "nights":
        argsObj.nights = parseInt(value, 10);
        break;
      case "budget":
        argsObj.budget = parseFloat(value);
        break;
      case "dates":
        argsObj.dates = value;
        break;
      default:
        break;
    }
  });

  return argsObj;
}

// function funding() {
//   const chatId = ctx.chat.id;
//   const userId = ctx.from.id;
//   const messageText = ctx.message?.text;

//   if (messageText === "✅") {
//     if (!agreedUsers.has(userId)) {
//       agreedUsers.add(userId);
//       ctx.reply(`User ${ctx.from.first_name} has agreed to the trip!`);

//       // Check if all users have agreed
//       if (agreedUsers.size >= totalMembers) {
//         ctx.reply(
//           "All members have agreed to the trip! 🎉 Booking will proceed now."
//         );
//         // add booking logic
//       }
//     } else {
//       ctx.reply("You have already responded with ✅.");
//     }
//   }
// }

// start bot
// Function to handle "funding is complete."
function handleFundingComplete(chatId: any) {
  bot.telegram.sendMessage(
    chatId,
    "Funding is complete! This event was triggered successfully."
  );
  console.log(`Funding complete message sent to chat ${chatId}`);
}

// Simplified health check endpoint
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// Wrap initialization in async function
async function initBot() {
  try {
    await client.connect();

    // Start both the bot and express server
    await Promise.all([
      bot.launch(),
      new Promise((resolve) => {
        app.listen(PORT, () => {
          console.log(`Server running on port ${PORT}`);
          resolve(true);
        });
      }),
    ]);

    console.log("Bot is running");
  } catch (error) {
    console.error("Failed to initialize:", error);
    process.exit(1);
  }
}

// Call the init function
initBot().catch(console.error);

// shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
