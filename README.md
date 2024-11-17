# 🤖 Book Me Bot

**Book Me Bot** is a Telegram bot that simplifies event coordination and decentralized wallet registration for users. This project integrates with **Coinbase MPC Wallet SDK** and **Nillion** APIs, demonstrating on-chain name registration and secure key management. Built for [Hackathon Name], this project targets the **Coinbase** and **Nillion** bounties.

## 🚀 Features

- **Seamless Wallet Creation**: Automatically creates Ethereum wallets using Coinbase MPC SDK.
- **On-Chain Basename Registration**: Registers a human-readable Basename (e.g., `brave-eagle-agent.basetest.eth`) on Base Sepolia.
- **Secure Key Storage**: Utilizes Nillion's secure storage APIs for private key management.
- **Decentralized Booking Requests**: Allows users to coordinate bookings and track votes directly within the Telegram chat.
- **Interactive Voting System**: Built-in voting feature for group decisions (e.g., hotel or event selection) that could be extended to voting within DAOs and many other use cases.

## 🏆 Tech Used

### 1. **Coinbase**

- **Integration**: Uses **Coinbase MPC Wallet SDK** to create wallets and register Basenames on-chain.
- **Key Highlight**: Demonstrates secure, decentralized wallet creation and management with Coinbase's SDK.

### 2. **Nillion**

- **Integration**: Uses **Nillion's secure storage** APIs for managing and retrieving private keys.
- **Key Highlight**: Leverages Nillion's decentralized storage for enhanced security and user privacy.

### 3. **Dynamic**

- **Integration**:
- **Key Highlight**:

## 📖 Tech Stack

- **Telegram Bot API**: For handling user interactions and commands.
- **Coinbase SDK**: For wallet creation and management.
- **Nillion APIs**: For secure private key storage.
- **Redis**: Caching and storing chat data for faster responses.
- **Ethers.js**: Interacting with Ethereum smart contracts on Base Sepolia.

## 📦 Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/BookMeBot/book-me-bot.git
   cd book-me-bot
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   - Create a `.env` file with the following variables:
     ```env
     TELEGRAM_BOT_TOKEN=your-telegram-bot-token
     PRIVATE_KEY=your-funding-wallet-private-key
     REDIS_HOST=your-redis-host
     REDIS_PORT=your-redis-port
     REDIS_PASSWORD=your-redis-password
     NILLION_USER_ID=your-nillion-user-id
     NILLION_API_BASE_URL=https://nillion-storage-apis-v0.onrender.com
     ```

4. Start the bot:
   ```bash
   npm run start
   ```
