import { Request, Response } from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";
import axios from "axios";
import { createClient } from "redis";
import { Telegraf, Markup } from "telegraf";
import express from "express";
import { CallbackQuery, Update } from "telegraf/typings/core/types/typegram";
import {
  generateAgentName,
  createRegisterContractMethodArgs,
  registrarAddress,
  registrarABI,
} from "./basenameUtils";

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

// grammyBot.on("message_reaction", async (ctx) => {
//   const { emoji, emojiAdded, emojiRemoved } = ctx.reactions();
//   console.log("reacted");
//   if (emojiRemoved.includes("👍")) {
//     // Upvote was removed! Unacceptable.
//     if (emoji.includes("👌")) {
//       // Still okay, do not punish
//       await ctx.reply("I forgive you");
//     } else {
//       // How dare they.
//       await ctx.banAuthor();
//     }
//   }
// });

// grammyBot.reaction(["👍", "👎"], (ctx) => {
//   console.log("hi");
//   ctx.reply("Nice thumb");
// });

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

export async function registerBasename(
  agentName: string,
  addressId: string,
  privateKey: string,
  ctx: any
) {
  const chatId = ctx.chat?.id.toString();
  const existingDataStr = await client.get(chatId);
  let chatData: ChatData = existingDataStr
    ? JSON.parse(existingDataStr)
    : { chatId };

  const appId = chatData.nillionId;

  console.log(!NILLION_USER_ID || !appId);

  if (!NILLION_USER_ID || !appId) {
    throw new Error("Nillion ID is required for basename");
  }

  try {
    const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(
      registrarAddress,
      registrarABI,
      wallet
    );

    const registerArgs = createRegisterContractMethodArgs(agentName, addressId);

    console.log(`Registering Basename: ${agentName}`);

    const tx = await contract.register(registerArgs.request, {
      value: ethers.parseEther("0.05"),
      gasLimit: 400000,
    });

    console.log("Transaction sent:", tx.hash);
    const receipt = await tx.wait();

    const successMessage = `Basename "${agentName}" registered successfully!`;
    const txLink = `Transaction link: https://sepolia.basescan.org/tx/${tx.hash}`;

    console.log(successMessage);
    console.log(txLink);

    // Send the success message and transaction link to the Telegram chat
    await ctx.reply(successMessage);
    await ctx.reply(txLink);
  } catch (error) {
    console.error("Error registering Basename:", error);
    await ctx.reply("Error registering Basename. Please try again later.");
  }
}

async function createWalletForChat(chatId: string, appId: string, ctx: any) {
  if (!appId || !NILLION_USER_ID) {
    throw new Error("App ID is required to create a wallet");
  }

  const wallet = ethers.Wallet.createRandom();

  console.log(`Created wallet for chat ${chatId}: ${wallet.address}`);
  await storePrivateKey(appId, NILLION_USER_ID, wallet.privateKey);

  // Fund the new wallet
  await fundWallet(wallet.address);

  // Generate a human-readable agent name
  const agentName = generateAgentName();
  console.log(`Generated Agent Name: ${agentName}`);

  // Register the Basename for the new wallet
  await registerBasename(agentName, wallet.address, wallet.privateKey, ctx);

  // Return the wallet information
  return {
    address: wallet.address,
    agentName,
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

bot.on("my_chat_member", async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  const userId = ctx.from?.id;
  const newStatus = ctx.update.my_chat_member?.new_chat_member?.status;
  // Send a welcome message
  await ctx.reply(
    `Welcome to BookMeBot! Let's plan your next trip 🏖 To help us find the best options for you, please provide the following details:

    1. Location: Where would you like to stay? (e.g., New York City, Paris)
    2. Dates: What are your check-in and check-out dates? (e.g., Check-in: 2025-09-15, Check-out: 2025-09-20)
    3. Price Range: What is your budget per person? (e.g., $100 per night)
    4. Amenities: Are there any specific amenities you desire? (e.g., Pool, Free Wi-Fi, Gym)
    5. Number of Guests: How many people will be staying? (e.g., 2 adults)

    Feel free to provide any additional preferences or requirements you might have. Let's make your stay unforgettable! 🏖`
  );
  // Check if the bot was added to the chat
  if (newStatus === "member") {
    const chatTitle = "this chat";
    console.log(`Bot added to chat: ${chatTitle} (ID: ${chatId})`);
    try {
      // Get existing data or initialize new
      const existingDataStr = await client.get(chatId);
      let chatData: ChatData = existingDataStr
        ? JSON.parse(existingDataStr)
        : { chatId };

      const appId = await registerAppId();
      chatData.nillionId = appId;

      const privateKey = await retrievePrivateKey(appId, NILLION_USER_ID);

      if (!privateKey && appId) {
        const wallet = await createWalletForChat(chatId, appId, ctx);
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

      // ctx.reply(`Chat initialized with ID: ${chatId}`);
    } catch (error) {
      console.error("Initialization failed:", error);
      ctx.reply("Failed to initialize chat");
    }
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

interface MessageReactionUpdated {
  chat: {
    id: number;
  };
  message_id: number;
  old_reaction: Array<{ type: string }>;
  new_reaction: Array<{ type: string }>;
  user: {
    id: number;
    first_name: string;
  };
}

bot.command("one", (ctx) => ctx.react("😍"));
// Track reactions using message_reaction update
bot.on("message_reaction", (ctx: any) => {
  const update = ctx.update as Update.MessageReactionUpdate;
  const reaction = update.message_reaction;

  // Get the new reactions added
  const newReactions = reaction.new_reaction.map((r: any) => r.type);
  const oldReactions = reaction.old_reaction.map((r: any) => r.type);

  console.log(`User ${reaction.user?.first_name} (ID: ${reaction.user?.id}):`);
  console.log(`- Removed reactions: ${oldReactions.join(", ") || "none"}`);
  console.log(`- Added reactions: ${newReactions.join(", ") || "none"}`);
  console.log(`Message ID: ${reaction.message_id}`);
});

bot.command("react2", (ctx: any) => {
  ctx.reply("React to this message:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👍", callback_data: "like" },
          { text: "❤️", callback_data: "love" },
          { text: "👎", callback_data: "dislike" },
        ],
      ],
    },
  });
});

// Handler for button clicks (callback queries)
bot.on("callback_query", async (ctx) => {
  const query = ctx.callbackQuery;

  if (query && "data" in query) {
    const userId = query.from.id;
    const reaction = query.data;
    const messageId = query.message && query.message.message_id;
    // Track the reaction
    console.log(
      `User ${userId} reacted with: ${reaction} to message id: ${messageId}`
    );

    // Optionally, send a response to the user
    await ctx.answerCbQuery(`You reacted with: ${reaction}`);
  }
});

// FUNDING
async function fundWallet(toAddress: string) {
  try {
    const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
    const fundingWallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

    console.log(`Funding wallet ${toAddress} with 0.01 ETH...`);
    const tx = await fundingWallet.sendTransaction({
      to: toAddress,
      value: ethers.parseEther("0.01"), // Amount to send
      gasLimit: 21000, // Gas limit for a simple transfer
    });

    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log(`Successfully funded wallet ${toAddress}`);
  } catch (error) {
    console.error("Error funding wallet:", error);
  }
}

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
interface Hotel {
  id: string;
  name: string;
}

interface VoteCount {
  [hotelId: string]: number;
}

// Example hotel data
const hotels: Hotel[] = [
  { id: "1", name: "Grand Plaza" },
  { id: "2", name: "Sunset Inn" },
  { id: "3", name: "Mountain Retreat" },
];

// Initialize vote tracking
const votes: VoteCount = Object.fromEntries(
  hotels.map((hotel) => [hotel.id, 0])
);

export function setupVotingSystem(bot: Telegraf) {
  // Create inline keyboard with hotel options
  const createHotelOptions = () =>
    Markup.inlineKeyboard(
      hotels.map((hotel) =>
        Markup.button.callback(
          `${hotel.name} (${votes[hotel.id]})`,
          `vote_${hotel.id}`
        )
      ),
      { columns: 1 } // Stack buttons vertically
    );

  // Command handler for /hotels
  bot.command("test", (ctx: any) => {
    ctx.reply("This is the /tests command.");
    // try {
    //   await ctx.reply("Choose your hotel:", createHotelOptions());
    // } catch (error) {
    //   console.error("Error sending hotel options:", error);
    //   await ctx.reply("An error occurred. Please try again.");
    // }
  });

  // Handle voting callbacks
  bot.on("callback_query", async (ctx: any) => {
    try {
      const query = ctx.callbackQuery as CallbackQuery.DataQuery;

      if (!query.data.startsWith("vote_")) {
        return;
      }

      const hotelId = query.data.split("_")[1];

      // Validate hotel ID
      if (!(hotelId in votes)) {
        await ctx.answerCbQuery("Invalid hotel selection", {
          show_alert: true,
        });
        return;
      }

      // Update vote count
      votes[hotelId]++;

      // Create vote summary
      const voteSummary = hotels
        .map((hotel) => `${hotel.name}: ${votes[hotel.id]} votes`)
        .join("\n");

      // Update message with new vote counts
      await ctx.editMessageText(
        `Current votes:\n${voteSummary}`,
        createHotelOptions()
      );

      // Confirm vote to user
      const hotel = hotels.find((h) => h.id === hotelId);
      await ctx.answerCbQuery(`Voted for ${hotel?.name}`);
    } catch (error) {
      console.error("Error processing vote:", error);
      await ctx.answerCbQuery("Error processing vote. Please try again.", {
        show_alert: true,
      });
    }
  });
}

async function sendDataToSearchAgent(chatId: string, text: string) {
  const agentApiUrl = "http://127.0.0.1:8000/chat";
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        agentApiUrl,
        {
          chatId,
          messages: [
            {
              text: `Based on this text, please find me the booking data: ${text}`,
            },
          ],
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Search agent response:", response.data);
      return response.data;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        // If this was the last attempt, handle the error gracefully
        console.error("All attempts to reach search agent failed");
        return {
          completedData: false,
          error: "Search service unavailable",
        };
      }

      // Wait before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

// listen for messages
bot.on("text", async (ctx: any) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const messageText = ctx.message?.text;
  const isFromBot = ctx.from.is_bot;

  console.log(isFromBot);
  console.log(messageText);

  //send data to agent backend
  // const dataFromAgent = await sendDataToSearchAgent(chatId, messageText);
  // const completedData = dataFromAgent.completedData;

  //if response has completeData = true then store the result data in redis
  // if (completedData) {
  //    console.log("completedData", completedData);
  //    await client.set('key', 'value');
  // }

  if (
    messageText ===
    "I'd like to book Nov 17, 2024 to Nov 20, 2024 in Chiang Mai, Thailand. My budget is $20 per night per person, there are a total of 2 people."
  ) {
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
        walletAddress: chatData.walletAddress,
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

      await ctx.reply(
        `Sounds like a fun trip! Please visit https://book-me-app-tau.vercel.app/?chatId=${chatId.toString()} to fund your AI travel account.`
      );
    } catch (error) {
      console.error("Redis operation failed:", error);
      ctx.reply("Failed to store/retrieve data");
    }
  }
});

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
const PORT = process.env.PORT || 3009;

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
