# Backend Speech - Real-Time Transcription Service

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

This project provides a Node.js backend service using WebSockets for real-time audio streaming and transcription via the Google Cloud Speech-to-Text API. It's built with TypeScript for enhanced code quality and maintainability.

## ✨ Features

*   **Real-time Audio Transcription:** Streams audio data received via WebSockets directly to Google Cloud Speech-to-Text.
*   **WebSocket Communication:** Establishes a WebSocket server (`ws`) to handle client connections and bidirectional communication.
*   **Google Cloud Integration:** Leverages the `@google-cloud/speech` library for powerful speech recognition capabilities.
*   **TypeScript:** Written in TypeScript for type safety and better developer experience.
*   **Environment-Aware Configuration:** Prioritizes environment variables for configuration (Port, Google Credentials) with sensible fallbacks.

## 🚀 Technology Stack

*   **Runtime:** Node.js
*   **Language:** TypeScript
*   **WebSocket Server:** [ws](https://github.com/websockets/ws)
*   **Speech Recognition:** [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text) (`@google-cloud/speech`)
*   **Development Tooling:** `nodemon`, `ts-node`

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [Yarn](https://yarnpkg.com/) (or npm)
*   A [Google Cloud Platform](https://cloud.google.com/) account with the Speech-to-Text API enabled.
*   Google Cloud Service Account Credentials (JSON key file).

## ⚙️ Configuration

1.  **Google Cloud Credentials:**
    *   The application requires Google Cloud credentials to authenticate with the Speech-to-Text API.
    *   **Recommended:** Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the *absolute path* of your downloaded service account JSON key file.
        ```bash
        # Example (Linux/macOS)
        export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/keyfile.json"

        # Example (Windows PowerShell)
        $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\your\keyfile.json"
        ```
    *   **Fallback:** If the environment variable is not set, the application will look for a file named `generative-456015-2182f613d6f3.json` in the project's root directory. **Ensure this file exists and is correctly named if you use this method.**

2.  **Port (Optional):**
    *   The server runs on port `8081` by default.
    *   You can override this by setting the `PORT` environment variable.

## 🔧 Installation

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <your-repository-url>
    cd speech-backend
    ```
2.  **Install dependencies:**
    ```bash
    yarn install
    # or
    npm install
    ```

## ▶️ Running the Project

1.  **Development Mode (with hot-reloading):**
    *   This uses `nodemon` to automatically restart the server when code changes are detected in the `src` directory.
    ```bash
    yarn dev
    # or
    npm run dev
    ```

2.  **Production Mode:**
    *   First, build the TypeScript code into JavaScript:
        ```bash
        yarn build
        # or
        npm run build
        ```
    *   Then, start the server using the compiled code in the `dist` directory:
        ```bash
        yarn start
        # or
        npm run start
        ```

Upon successful startup, you should see logs indicating the WebSocket server is running and the Google Speech Client has initialized:

```
[Config] WebSocket server configured for port: 8081
[Config] Expected audio sample rate: 48000 Hz
[Credentials] Using credentials from environment variable: /path/to/your/keyfile.json (or fallback message)
[Init] Initializing Google Speech Client...
[Init] Google Speech Client initialized successfully!
[Server] WebSocket server started on port 8081
[Server] WebSocket connection handler configured and awaiting connections.
```

## 🔌 Usage (Client Interaction)

1.  **Connect:** Clients should establish a WebSocket connection to `ws://<your-server-ip-or-domain>:<PORT>` (e.g., `ws://localhost:8081`).
2.  **Send Audio:**
    *   Stream audio data as binary `Buffer` messages over the WebSocket connection.
    *   The expected audio format is **`LINEAR16`** (16-bit linear PCM).
    *   The expected sample rate is **`48000 Hz`**. Ensure the client sends audio matching this configuration. The server logs the `EXPECTED_SAMPLE_RATE` on startup.
3.  **Receive Transcriptions:**
    *   The server will stream transcription results back to the client as JSON string messages. Check the `src/server.ts` `recognizeStream.on('data', ...)` handler for the exact structure of the response. It typically includes fields like `results[0].alternatives[0].transcript`.

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file (if one exists) or the badge above for details.
